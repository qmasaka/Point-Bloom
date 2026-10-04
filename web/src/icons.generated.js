export const ICON_PATHS = {};
const NAMES = ["align-bottom-simple", "arrow-clockwise", "arrow-counter-clockwise", "arrows-clockwise", "arrows-in-simple", "arrows-left-right", "arrows-merge", "arrows-out-cardinal", "arrows-out-simple", "arrows-vertical", "broom", "camera", "caret-down", "caret-right", "check", "check-circle", "checkerboard", "circle", "circle-half", "code", "compass", "copy", "copy-simple", "corners-out", "crosshair-simple", "cube", "cube-focus", "cube-transparent", "cursor", "device-mobile", "dots-nine", "download-simple", "drop", "eye", "eye-slash", "file", "flip-horizontal", "flip-vertical", "folder-open", "gauge", "globe", "image", "images", "info", "link", "magnet", "monitor", "moon", "palette", "perspective", "plus", "question", "repeat", "ruler", "selection", "sidebar-simple", "sliders-horizontal", "sparkle", "sphere", "square-half", "stack", "sun", "swatches", "trash", "tree-structure", "upload-simple", "warning", "warning-circle", "x"];
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
