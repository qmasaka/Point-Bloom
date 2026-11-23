const SAMPLE_SIZE = 256;
const TAU = Math.PI * 2;
function spreadBits(v) {
v = (v | (v << 8)) & 0x00ff00ff;
v = (v | (v << 4)) & 0x0f0f0f0f;
v = (v | (v << 2)) & 0x33333333;
return (v | (v << 1)) & 0x55555555;
}
function planeKey(x, y) {
const q = (v) => Math.max(0, Math.min(1023, Math.round(v * 1023)));
return spreadBits(q(x)) | (spreadBits(q(y)) << 1);
}
function linearByte(v) {
const c = v / 255;
return Math.round((c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4) * 255);
}
export async function readParallaxPhoto(file) {
const bitmap = await createImageBitmap(file);
const canvas = document.createElement('canvas');
const scale = SAMPLE_SIZE / Math.max(bitmap.width, bitmap.height);
const w = canvas.width = Math.max(1, Math.round(bitmap.width * scale));
const h = canvas.height = Math.max(1, Math.round(bitmap.height * scale));
const ctx = canvas.getContext('2d', { willReadFrequently: true });
try {
ctx.drawImage(bitmap, 0, 0, w, h);
} finally {
bitmap.close();
}
const rgba = ctx.getImageData(0, 0, w, h).data;
const thumb = canvas.toDataURL('image/jpeg', 0.72);
const pixels = [];
const ratio = 2.22 / Math.max(w, h);
for (let y = 0; y < h; y++) {
for (let x = 0; x < w; x++) {
const p = (x + y * w) * 4;
if (rgba[p + 3] < 72) continue;
const rgb = linearByte(rgba[p]) + linearByte(rgba[p + 1]) * 256 + linearByte(rgba[p + 2]) * 65536;
pixels.push({ x: (x + 0.5 - w / 2) * ratio, y: (h / 2 - y - 0.5) * ratio, rgb, key: planeKey((x + 0.5) / w, 1 - (y + 0.5) / h) });
}
}
if (!pixels.length) throw new Error('empty photo');
pixels.sort((a, b) => a.key - b.key);
return { name: file.name, pixels, pitch: ratio, thumb };
}
export function packParallaxSlot(photo, attribute, count, slot, out, start) {
const angle = slot * TAU / 3;
const c = Math.cos(angle), s = Math.sin(angle);
const px = new Float32Array(count), py = new Float32Array(count), keys = new Uint32Array(count);
const order = new Uint32Array(count);
let left = Infinity, right = -Infinity, bottom = Infinity, top = -Infinity;
for (let i = 0; i < count; i++) {
const p = Math.min(attribute.count - 1, Math.floor((i + 0.5) * attribute.count / count)) * 3;
const x = attribute.array[p] * c - attribute.array[p + 2] * s;
const y = attribute.array[p + 1];
left = Math.min(left, x); right = Math.max(right, x);
bottom = Math.min(bottom, y); top = Math.max(top, y);
px[i] = x; py[i] = y; order[i] = i;
}
for (let i = 0; i < count; i++) keys[i] = planeKey((px[i] - left) / Math.max(0.0001, right - left), (py[i] - bottom) / Math.max(0.0001, top - bottom));
order.sort((a, b) => keys[a] - keys[b]);
const { pixels, pitch } = photo;
for (let rank = 0; rank < count; rank++) {
const pixel = pixels[Math.min(pixels.length - 1, Math.floor((rank + 0.5) * pixels.length / count))];
const i = order[rank];
const p = start + i * 4;
const dx = ((rank * 0.61803398875) % 1 - 0.5) * pitch;
const dy = ((rank * 0.75487766625) % 1 - 0.5) * pitch;
out[p] = (pixel.x + dx) * c;
out[p + 1] = pixel.y + dy;
out[p + 2] = -(pixel.x + dx) * s;
out[p + 3] = pixel.rgb;
}
}
