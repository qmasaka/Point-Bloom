export const ICON_PATHS = {};
const NAMES = ["align-bottom-simple", "aperture", "arrow-clockwise", "arrow-counter-clockwise", "arrow-right", "arrows-clockwise", "arrows-in-simple", "arrows-left-right", "arrows-merge", "arrows-out-cardinal", "arrows-out-simple", "arrows-vertical", "asterisk", "atom", "bounding-box", "broom", "camera", "caret-down", "caret-right", "check", "check-circle", "checkerboard", "circle", "circle-half", "code", "compass", "copy", "copy-simple", "corners-out", "crosshair-simple", "cube", "cube-focus", "cube-transparent", "cursor", "cursor-click", "device-mobile", "dna", "dots-nine", "download-simple", "drop", "equalizer", "eye", "eye-slash", "file", "film-strip", "flag", "flip-horizontal", "flip-vertical", "folder-open", "gauge", "ghost", "globe", "grid-four", "hand", "image", "images", "info", "lightning", "magnet", "minus", "monitor", "paint-brush", "palette", "path", "pause", "perspective", "planet", "play", "plus", "pulse", "question", "record", "repeat", "ruler", "scan", "selection", "share-network", "sliders-horizontal", "snowflake", "sparkle", "speaker-high", "speaker-slash", "sphere", "spiral", "square-half", "squares-four", "stack", "swatches", "target", "text-aa", "tornado", "trash", "tree-structure", "upload-simple", "video-camera", "warning", "warning-circle", "waveform", "waves", "wind", "x"];
const BASE = 'https://cdn.jsdelivr.net/npm/@phosphor-icons/core@2.1.1/assets/regular/';
export const loadIcons = () =>
Promise.all(
NAMES.map((n) =>
fetch(BASE + n + '.svg')
.then((r) => (r.ok ? r.text() : ''))
.then((t) => {
const m = /<svg[^>]*>([\s\S]*)<\/svg>/.exec(t);
if (m) ICON_PATHS[n] = m[1].trim();
})
.catch(() => {})
)
);
