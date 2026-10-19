import * as THREE from 'three';
import { clamp } from '../../core/util.js';
export class SlitPart {
_slitTick(rgbNew, u) {
const S = this.state.layers.slitscan;
const pm = this.pm;
const ok = S.on && this.state.source === 'media' && pm.ready && (pm.kind === 'video' || pm.isRec) && this.geometry?.attributes.position.count === pm.count;
const eff = ok ? clamp(this._eff(S), 0, 1.5) : 0;
if (eff <= 0.001) {
u.uSlit.value.x = 0;
return;
}
const cols = pm.cols, rows = pm.rows;
const per = cols * rows * 4;
const M = Math.max(4, Math.min(Math.round(S.frames || 48), Math.floor(64e6 / per)));
let H = this._slit;
if (!H || H.cols !== cols || H.rows !== rows || H.M !== M) {
H?.tex.dispose();
const data = new Uint8Array(per * M);
const tex = new THREE.DataArrayTexture(data, cols, rows, M);
tex.format = THREE.RGBAFormat;
tex.type = THREE.UnsignedByteType;
tex.colorSpace = THREE.SRGBColorSpace;
tex.minFilter = tex.magFilter = THREE.NearestFilter;
tex.generateMipmaps = false;
tex.unpackAlignment = 1;
H = this._slit = { cols, rows, M, data, tex, head: 0, filled: false };
}
const rgb = rgbNew || (!H.filled ? pm.sample() : null);
if (rgb) {
const write = (layer) => {
const d = H.data;
let o = layer * per;
for (let i = 0; i < rgb.length; i += 3) {
d[o] = rgb[i];
d[o + 1] = rgb[i + 1];
d[o + 2] = rgb[i + 2];
d[o + 3] = 255;
o += 4;
}
};
if (!H.filled) {
for (let l = 0; l < M; l++) write(l);
H.filled = true;
H.tex.clearLayerUpdates?.();
} else {
H.head = (H.head + 1) % M;
write(H.head);
H.tex.addLayerUpdate?.(H.head);
}
H.tex.needsUpdate = true;
}
if (u.uSlitTex.value !== H.tex) u.uSlitTex.value = H.tex;
u.uSlit.value.set(eff, S.length ?? 0.8, H.head, { rows: 0, cols: 1, radial: 2, depth: 3, noise: 4 }[S.mode] ?? 0);
u.uSlitP.value.set(S.dir === 'back' ? -1 : 1, S.sweep || 0, S.push || 0, Math.round(S.bands || 0));
u.uSlitG.value.set(cols, rows, cols * rows, M);
}
}
