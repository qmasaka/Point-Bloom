#!/usr/bin/env python3
import os
import re
import sys
import time

ROOT = os.path.dirname(os.path.abspath(__file__))

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

def rel(p):
    return os.path.relpath(p, ROOT).replace(os.sep, "/")

ENTRY = os.path.join(ROOT, "src", "main.js")
ICONS_GENERATED = os.path.join(ROOT, "src", "ui", "icons.generated.js")
OUT = os.path.join(ROOT, "assets", "app.js")
THREE = os.path.join(ROOT, "vendor", "three", "build", "three.module.js")
ADDONS = os.path.join(ROOT, "vendor", "three", "addons")

DECL_RE = re.compile(r"^export\s+(?:async\s+)?(const|let|var|function\*?|class)\s+([A-Za-z_$][\w$]*)")
DEFAULT_RE = re.compile(r"^export\s+default\s+")
NAME_RE = re.compile(r"^[A-Za-z_$][\w$]*$")

def resolve(spec, importer):
    if spec == "three":
        return THREE
    if spec.startswith("three/addons/"):
        return os.path.join(ADDONS, spec[len("three/addons/"):])
    if spec.startswith("."):
        return os.path.normpath(os.path.join(os.path.dirname(importer), spec))
    raise SystemExit("Не могу разрешить импорт %r из %s" % (spec, importer))

def collect_statement(lines, i):
    buf = [lines[i]]
    while not re.search(r";\s*(//.*)?$", buf[-1]) and i + 1 < len(lines):
        i += 1
        buf.append(lines[i])
    return "\n".join(buf), i + 1

def split_names(body):
    items = []
    for part in body.split(","):
        part = part.strip()
        if not part:
            continue
        m = re.match(r"^([\w$]+)(?:\s+as\s+([\w$]+))?$", part)
        if not m:
            raise SystemExit("Не понял список имён: %r" % part)
        items.append((m.group(1), m.group(2) or m.group(1)))
    return items

def transform(path, src):
    lines = src.split("\n")
    out = []
    head = []
    deps = []
    i = 0
    n_req = 0
    in_block_comment = False
    while i < len(lines):
        line = lines[i]
        stripped = line.lstrip()
        if in_block_comment:
            out.append(line)
            if "*/" in line:
                in_block_comment = False
            i += 1
            continue
        if stripped.startswith("/*") and "*/" not in stripped:
            in_block_comment = True
            out.append(line)
            i += 1
            continue

        if re.match(r"^import\s*[\w{*]", line) or re.match(r"^import\s*\{", line):
            stmt, i = collect_statement(lines, i)
            flat = " ".join(stmt.split())
            m = re.match(r"^import\s+(.+?)\s+from\s+['\"]([^'\"]+)['\"]\s*;?", flat)
            if not m:
                m2 = re.match(r"^import\s+['\"]([^'\"]+)['\"]\s*;?", flat)
                if not m2:
                    raise SystemExit("Не понял import в %s: %s" % (path, flat[:120]))
                out.append("__req(%r);" % resolve(m2.group(1), path))
                deps.append(resolve(m2.group(1), path))
                continue
            clause, spec = m.group(1), m.group(2)
            target = resolve(spec, path)
            deps.append(target)
            tid = repr(rel(target))
            default_name = None
            ns_name = None
            named = []
            mm = re.match(r"^([\w$]+)\s*,\s*(.+)$", clause)
            if mm and not clause.startswith("{") and not clause.startswith("*"):
                default_name, clause = mm.group(1), mm.group(2)
            if clause.startswith("*"):
                ns_name = re.match(r"^\*\s+as\s+([\w$]+)$", clause).group(1)
            elif clause.startswith("{"):
                named = split_names(clause.strip()[1:-1])
            else:
                default_name = clause
            code = []
            if default_name:
                code.append("const %s = __req(%s).default;" % (default_name, tid))
            if ns_name:
                code.append("const %s = __req(%s);" % (ns_name, tid))
            if named:
                inner = ", ".join(a if a == b else "%s: %s" % (a, b) for a, b in named)
                code.append("const { %s } = __req(%s);" % (inner, tid))
            out.append(" ".join(code))
            continue

        if line.startswith("export"):
            m = DECL_RE.match(line)
            if m:
                name = m.group(2)
                head.append("__def(__exports, %r, () => %s);" % (name, name))
                out.append(re.sub(r"^export\s+", "", line, count=1))
                i += 1
                continue
            if DEFAULT_RE.match(line):
                rest = DEFAULT_RE.sub("", line, count=1)
                m2 = re.match(r"^(?:async\s+)?(?:function\*?|class)\s+([\w$]+)", rest)
                if m2:
                    head.append("__def(__exports, 'default', () => %s);" % m2.group(1))
                    out.append(rest)
                else:
                    out.append("const __default = " + rest)
                    head.append("__def(__exports, 'default', () => __default);")
                i += 1
                continue
            if re.match(r"^export\s*\{", line):
                stmt, i = collect_statement(lines, i)
                flat = " ".join(stmt.split())
                m3 = re.match(r"^export\s*\{(.*?)\}\s*(?:from\s+['\"]([^'\"]+)['\"])?\s*;?$", flat)
                if not m3:
                    raise SystemExit("Не понял export в %s: %s" % (path, flat[:120]))
                names = split_names(m3.group(1))
                if m3.group(2):
                    target = resolve(m3.group(2), path)
                    deps.append(target)
                    n_req += 1
                    var = "__re%d" % n_req
                    head.append("const %s = __req(%r);" % (var, rel(target)))
                    for a, b in names:
                        head.append("__def(__exports, %r, () => %s.%s);" % (b, var, a))
                else:
                    for a, b in names:
                        head.append("__def(__exports, %r, () => %s);" % (b, a))
                continue
            raise SystemExit("Неподдерживаемый export в %s: %s" % (path, line[:100]))

        out.append(line)
        i += 1
    return "\n".join(head + out), deps

def gen_icons():
    d = os.path.join(ROOT, "vendor", "phosphor", "regular")
    items = {}
    for f in sorted(os.listdir(d)):
        if f.endswith(".svg"):
            with open(os.path.join(d, f), encoding="utf-8") as fh:
                m = re.search(r"<svg[^>]*>(.*)</svg>", fh.read(), re.S)
            items[f[:-4]] = m.group(1).strip()
    corpus = ""
    for base, _, files in os.walk(os.path.join(ROOT, "src")):
        for name in files:
            if name.endswith(".js") and name != "icons.generated.js":
                with open(os.path.join(base, name), encoding="utf-8") as fh:
                    corpus += fh.read()
    with open(os.path.join(ROOT, "index.html"), encoding="utf-8") as fh:
        corpus += fh.read()
    items = {k: v for k, v in items.items() if re.search(r"['\"]" + re.escape(k) + r"['\"]", corpus)}
    out = ["export const ICON_PATHS = {"]
    for k, v in items.items():
        out.append("\t%r: %r," % (k, v))
    out.append("};")
    out.append("export const loadIcons = () => Promise.resolve();")
    with open(ICONS_GENERATED, "w", encoding="utf-8") as fh:
        fh.write("\n".join(out) + "\n")
    return sorted(items.keys())

def gen_fonts_css():
    import base64
    fonts = os.path.join(ROOT, "assets", "fonts")
    faces = [
        ("Geist", "geist-latin-wght-normal.woff2", "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD"),
        ("Geist", "geist-cyrillic-wght-normal.woff2", "U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116"),
        ("Geist Mono", "geist-mono-latin-wght-normal.woff2", "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD"),
    ]
    css = []
    for fam, fn, rng in faces:
        with open(os.path.join(fonts, fn), "rb") as fh:
            b64 = base64.b64encode(fh.read()).decode()
        css.append(
            "@font-face{font-family:'%s';font-style:normal;font-weight:100 900;font-display:swap;"
            "src:url(data:font/woff2;base64,%s) format('woff2');unicode-range:%s}" % (fam, b64, rng)
        )
    with open(os.path.join(ROOT, "assets", "fonts.css"), "w", encoding="utf-8") as fh:
        fh.write("\n".join(css) + "\n")

def bundle():
    gen_icons()
    gen_fonts_css()
    order, seen = [], set()

    def visit(p):
        if p in seen:
            return
        seen.add(p)
        with open(p, encoding="utf-8") as f:
            src = f.read()
        code, deps = transform(p, src)
        for d in deps:
            visit(d)
        order.append((p, code))

    visit(ENTRY)
    parts = [
        "(function () {",
        "'use strict';",
        "const __defs = Object.create(null), __cache = Object.create(null);",
        "const __def = (o, k, g) => Object.defineProperty(o, k, { enumerable: true, get: g });",
        "function __req(id) {",
        "  if (__cache[id]) return __cache[id].exports;",
        "  const mod = __cache[id] = { exports: Object.create(null) };",
        "  const fn = __defs[id];",
        "  if (!fn) throw new Error('module not found: ' + id);",
        "  fn(mod.exports, __req);",
        "  return mod.exports;",
        "}",
    ]
    for p, code in order:
        rid = rel(p)
        parts.append("__defs[%r] = function (__exports, __req) {\n'use strict';\n%s\n};" % (rid, code))
    parts.append("__req(%r);" % rel(ENTRY))
    parts.append("})();")
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    text = "\n".join(parts)
    if "--dev" not in sys.argv and "--watch" not in sys.argv:
        text = minify_js(text)
    with open(OUT, "w", encoding="utf-8") as f:
        f.write(text)
    size = os.path.getsize(OUT) / 1024
    print("Собрано %s (%d модулей, %.0f КБ)" % (os.path.relpath(OUT, ROOT), len(order), size))

JS_REGEX_PREV = set("(,=:[!&|?{};+-*%<>~^")
JS_REGEX_KW = {"return", "typeof", "case", "in", "of", "void", "delete", "throw", "new", "else", "do"}

def minify_js(src):
    out = []
    i, n = 0, len(src)
    prev_sig = ""
    word = ""
    stack = []
    depth = 0
    at_line_start = True

    def last_char():
        return out[-1] if out else "\n"

    while i < n:
        c = src[i]
        nxt = src[i + 1] if i + 1 < n else ""
        if c == "/" and nxt == "/":
            while i < n and src[i] != "\n":
                i += 1
            continue
        if c == "/" and nxt == "*":
            j = src.index("*/", i + 2)
            i = j + 2
            if last_char() not in " \n\t":
                out.append(" ")
            continue
        if c in "'\"":
            q = c
            j = i + 1
            while src[j] != q:
                j += 2 if src[j] == "\\" else 1
            out.append(src[i:j + 1])
            i = j + 1
            prev_sig, word, at_line_start = q, "", False
            continue
        if c == "`":
            j = i + 1
            out.append("`")
            while True:
                ch = src[j]
                if ch == "\\":
                    out.append(src[j:j + 2])
                    j += 2
                    continue
                if ch == "`":
                    out.append("`")
                    j += 1
                    break
                if ch == "$" and src[j + 1] == "{":
                    k = j + 2
                    level = 1
                    while level:
                        ck = src[k]
                        if ck in "'\"":
                            qq = ck
                            k += 1
                            while src[k] != qq:
                                k += 2 if src[k] == "\\" else 1
                        elif ck == "`":
                            k += 1
                            while src[k] != "`":
                                k += 2 if src[k] == "\\" else 1
                        elif ck == "{":
                            level += 1
                        elif ck == "}":
                            level -= 1
                        k += 1
                    out.append(src[j:k])
                    j = k
                    continue
                out.append(ch)
                j += 1
            i = j
            prev_sig, word, at_line_start = "`", "", False
            continue
        if c == "/":
            is_regex = prev_sig == "" or prev_sig in JS_REGEX_PREV or word in JS_REGEX_KW
            if is_regex and prev_sig not in ")]}" :
                j = i + 1
                in_class = False
                while True:
                    ch = src[j]
                    if ch == "\\":
                        j += 2
                        continue
                    if ch == "[":
                        in_class = True
                    elif ch == "]":
                        in_class = False
                    elif ch == "/" and not in_class:
                        break
                    j += 1
                j += 1
                while j < n and src[j].isalpha():
                    j += 1
                out.append(src[i:j])
                i = j
                prev_sig, word, at_line_start = ")", "", False
                continue
        if c == "\n":
            while out and out[-1] in " \t":
                out.pop()
            if out and out[-1] != "\n":
                out.append("\n")
            at_line_start = True
            i += 1
            continue
        if c in " \t\r":
            if not at_line_start and last_char() not in " \n\t":
                out.append(" ")
            i += 1
            continue
        out.append(c)
        at_line_start = False
        if c.isalnum() or c in "_$":
            word = word + c if (word and (src[i - 1].isalnum() or src[i - 1] in "_$")) else c
        else:
            word = ""
        prev_sig = c
        i += 1
    return "".join(out).strip() + "\n"

def minify_css(s):
    s = re.sub(r"/\*.*?\*/", "", s, flags=re.S)
    s = re.sub(r"\s+", " ", s)
    s = re.sub(r"\s*([{};,>])\s*", r"\1", s)
    s = re.sub(r"\s*:\s*", ":", s)
    s = s.replace(";}", "}")
    return s.strip() + "\n"

WEB_HEAD = (
    '<link rel="preconnect" href="https://cdn.jsdelivr.net" crossorigin>\n'
    '\t<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@fontsource-variable/geist@5.3.0/index.css">\n'
    '\t<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@fontsource-variable/geist-mono@5.3.0/index.css">'
)
WEB_SCRIPT = (
    '<script type="importmap">{"imports":{"three":"https://cdn.jsdelivr.net/npm/three@0.186.1/build/three.module.js",'
    '"three/addons/":"https://cdn.jsdelivr.net/npm/three@0.186.1/examples/jsm/"}}</script>\n'
    '<script type="module" src="src/main.js"></script>'
)

WEB_ICONS = """export const ICON_PATHS = {};
const NAMES = __NAMES__;
const BASE = 'https://cdn.jsdelivr.net/npm/@phosphor-icons/core@2.1.1/assets/regular/';
export const loadIcons = () =>
	Promise.all(
		NAMES.map((n) =>
			fetch(BASE + n + '.svg')
				.then((r) => (r.ok ? r.text() : ''))
				.then((t) => {
					const m = /<svg[^>]*>([\\s\\S]*)<\\/svg>/.exec(t);
					if (m) ICON_PATHS[n] = m[1].trim();
				})
				.catch(() => {})
		)
	);
"""

def write_vercel_json():
    import base64, hashlib, json

    m = re.search(r"<script type=\"importmap\">(.*?)</script>", WEB_SCRIPT, re.S)
    digest = base64.b64encode(hashlib.sha256(m.group(1).encode("utf-8")).digest()).decode()
    csp = "; ".join(
        [
            "default-src 'self'",
            "script-src 'self' 'wasm-unsafe-eval' 'sha256-%s' https://cdn.jsdelivr.net https://*.plerdy.com" % digest,
            "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://*.plerdy.com",
            "font-src 'self' data: https://cdn.jsdelivr.net",
            "img-src 'self' data: blob: https://*.plerdy.com",
            "frame-src 'self' https://*.plerdy.com",
            "media-src 'self' blob: mediastream:",
            "connect-src 'self' https: blob: data:",
            "worker-src 'self' blob:",
            "object-src 'none'",
            "base-uri 'self'",
            "form-action 'none'",
            "frame-ancestors 'none'",
            "upgrade-insecure-requests",
        ]
    )
    headers = [
        ("Content-Security-Policy", csp),
        ("Strict-Transport-Security", "max-age=63072000; includeSubDomains"),
        ("X-Content-Type-Options", "nosniff"),
        ("X-Frame-Options", "DENY"),
        ("Referrer-Policy", "strict-origin-when-cross-origin"),
        ("Permissions-Policy", "camera=(self), microphone=(self), geolocation=(), payment=(), usb=(), serial=(), bluetooth=(), accelerometer=(), gyroscope=(), magnetometer=(), interest-cohort=()"),
        ("Cross-Origin-Opener-Policy", "same-origin"),
        ("Cross-Origin-Resource-Policy", "same-origin"),
        ("Access-Control-Allow-Origin", "https://pointbloom.vercel.app"),
    ]
    cfg = {
        "version": 2,
        "cleanUrls": True,
        "outputDirectory": "web",
        "headers": [
            {"source": "/(.*)", "headers": [{"key": k, "value": v} for k, v in headers]},
            {"source": "/sw.js", "headers": [{"key": "Cache-Control", "value": "no-cache"}, {"key": "Service-Worker-Allowed", "value": "/"}]},
            {"source": "/manifest.webmanifest", "headers": [{"key": "Content-Type", "value": "application/manifest+json"}, {"key": "Cache-Control", "value": "no-cache"}]},
            {"source": "/vendor/mediapipe/(.*)", "headers": [{"key": "Cache-Control", "value": "public, max-age=2592000"}]},
        ],
    }
    with open(os.path.join(ROOT, "vercel.json"), "w", encoding="utf-8") as fh:
        json.dump(cfg, fh, indent=2, ensure_ascii=False)
        fh.write("\n")

def build_web():
    import shutil
    icon_names = gen_icons()
    out = os.path.join(ROOT, "web")
    if os.path.isdir(out):
        shutil.rmtree(out)
    os.makedirs(os.path.join(out, "src"))
    os.makedirs(os.path.join(out, "assets"))
    total = 0
    for base, dirs, names in os.walk(os.path.join(ROOT, "src")):
        dirs.sort()
        for name in sorted(names):
            if not name.endswith(".js"):
                continue
            path = os.path.join(base, name)
            with open(path, encoding="utf-8") as fh:
                code = fh.read()
            if path == ICONS_GENERATED:
                code = WEB_ICONS.replace("__NAMES__", repr(icon_names).replace("'", '"'))
            code = minify_js(code)
            dest = os.path.join(out, os.path.relpath(path, ROOT))
            os.makedirs(os.path.dirname(dest), exist_ok=True)
            with open(dest, "w", encoding="utf-8") as fh:
                fh.write(code)
            total += len(code.encode("utf-8"))
    mp_src = os.path.join(ROOT, "vendor", "mediapipe")
    if os.path.isdir(mp_src):
        shutil.copytree(mp_src, os.path.join(out, "vendor", "mediapipe"))
    for f in ("manifest.webmanifest", "sw.js", "plerdy.js"):
        shutil.copy(os.path.join(ROOT, f), os.path.join(out, f))
    shutil.copytree(os.path.join(ROOT, "assets", "pwa"), os.path.join(out, "assets", "pwa"))
    with open(os.path.join(ROOT, "assets", "style.css"), encoding="utf-8") as fh:
        css = minify_css(fh.read())
    with open(os.path.join(out, "assets", "style.css"), "w", encoding="utf-8") as fh:
        fh.write(css)
    with open(os.path.join(ROOT, "index.html"), encoding="utf-8") as fh:
        html = fh.read()
    html = html.replace('<link rel="stylesheet" href="assets/fonts.css">', WEB_HEAD)
    html = html.replace('<script src="assets/app.js"></script>', WEB_SCRIPT)
    with open(os.path.join(out, "index.html"), "w", encoding="utf-8") as fh:
        fh.write(html)
    write_vercel_json()
    print("Веб-версия: web/ (JS %.0f КБ, CSS %.0f КБ, HTML %.0f КБ)" % (total / 1024, len(css) / 1024, len(html) / 1024))

def newest_mtime():
    latest = 0
    for base, _, files in os.walk(os.path.join(ROOT, "src")):
        for name in files:
            if name.endswith(".js"):
                latest = max(latest, os.path.getmtime(os.path.join(base, name)))
    return latest

if __name__ == "__main__":
    if "--web" in sys.argv:
        build_web()
        sys.exit(0)
    bundle()
    if "--watch" in sys.argv:
        print("Слежу за src/ … (Ctrl+C — выход)")
        last = newest_mtime()
        while True:
            time.sleep(0.6)
            cur = newest_mtime()
            if cur != last:
                last = cur
                try:
                    bundle()
                except SystemExit as e:
                    print("Ошибка сборки:", e)
