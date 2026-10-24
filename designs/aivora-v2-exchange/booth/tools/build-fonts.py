#!/usr/bin/env python3
"""build-fonts.py — local, offline webfonts for the Aivora booth kit.

Writes woff2 files to ../assets/fonts/ and @font-face rules to ../assets/fonts.css
(all src URLs are relative: url(fonts/...)). Family names are fixed so the pages'
CSS stacks keep working: "Archivo", "IBM Plex Mono", "Doto", "Noto Sans SC".

  * Archivo        variable wdth 62-125 / wght 100-900, latin + latin-ext, plus a tiny
                   "symbols" face (same family name) for the arrows / math signs the
                   pages use that Google's latin slices leave out (e.g. "→", "≠")
  * IBM Plex Mono  400 / 500 / 600, latin + latin-ext
  * Doto           900, latin
  * Noto Sans SC   400 / 500 / 700, SUBSET to the CJK characters the booth actually
                   uses (scanned from the pages) + a safety set of the 500 most common
                   Simplified Chinese characters + a few booth/trade-show terms.

Usage (python3 3.9+, stdlib only; fontTools is used for verification if installed):

  python3 designs/aivora-v2-exchange/booth/tools/build-fonts.py            # normal run
  python3 designs/aivora-v2-exchange/booth/tools/build-fonts.py --check    # offline: are all page chars covered?
  python3 designs/aivora-v2-exchange/booth/tools/build-fonts.py --refresh-latin   # re-download latin families too

A normal run re-scans the pages and rebuilds ONLY the page-dependent blocks (Noto Sans SC
and Archivo symbols, and their files); the latin families are downloaded only when their
files/blocks are missing.
Re-run it whenever page copy changes. Needs network access to fonts.googleapis.com.
"""

import argparse
import glob
import hashlib
import io
import os
import re
import sys
import time
import unicodedata
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
BOOTH = os.path.dirname(HERE)
ASSETS = os.path.join(BOOTH, "assets")
FONTS_DIR = os.path.join(ASSETS, "fonts")
CSS_PATH = os.path.join(ASSETS, "fonts.css")
CHARS_PATH = os.path.join(FONTS_DIR, "noto-sans-sc-chars.txt")

# Files scanned for CJK characters (relative to the booth folder).
SCAN_GLOBS = ["*.html", "*.js", "*.mjs", "*.css", "*.json", "assets/*.js", "assets/*.json"]

API = "https://fonts.googleapis.com/css2"
# Desktop Chrome UA so the API answers with woff2 (and unicode-range slices).
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36")

LATIN_FAMILIES = [
    {"name": "Archivo", "slug": "archivo",
     "query": "Archivo:wdth,wght@62..125,100..900", "subsets": ("latin", "latin-ext")},
    {"name": "IBM Plex Mono", "slug": "ibm-plex-mono",
     "query": "IBM Plex Mono:wght@400;500;600", "subsets": ("latin", "latin-ext")},
    {"name": "Doto", "slug": "doto",
     "query": "Doto:wght@900", "subsets": ("latin",)},
]
CJK_FAMILY = {"name": "Noto Sans SC", "slug": "noto-sans-sc",
              "query": "Noto Sans SC:wght@400;500;700"}
# Archivo has "→", "≠" etc., but Google's latin / latin-ext slices omit them, so they would
# fall back to a system font (e.g. the arrow in the hero claim). Fetched via text= as one
# small variable face with the same family name; its unicode-range never overlaps the slices.
SYMBOL_FACE = {"name": "Archivo symbols", "family": "Archivo", "slug": "archivo-symbols",
               "query": LATIN_FAMILIES[0]["query"]}
SYMBOL_RANGES = [(0x2190, 0x21FF), (0x2200, 0x22FF), (0x2300, 0x23FF), (0x25A0, 0x25FF)]
SYMBOL_SAFETY = "←→≈≠≤≥"  # all present in Archivo
SYMBOLS_PATH = os.path.join(FONTS_DIR, "archivo-symbols-chars.txt")
BLOCK_ORDER = ([LATIN_FAMILIES[0]["name"], SYMBOL_FACE["name"]]
               + [f["name"] for f in LATIN_FAMILIES[1:]] + [CJK_FAMILY["name"]])

# Characters scanned from the pages: CJK punctuation, CJK Ext-A, CJK unified, fullwidth forms.
CJK_RANGES = [(0x3000, 0x303F), (0x3400, 0x4DBF), (0x4E00, 0x9FFF), (0xFF00, 0xFFEF)]

# The text= API silently falls back to the full (~100 slice) font when the text gets
# long (observed between 800 and 900 chars); request in chunks well below that.
DEFAULT_CHUNK = 400
SIZE_BUDGET = 1_500_000  # bytes, all woff2 in assets/fonts

# Safety set: the most frequent Simplified Chinese characters (modern-Chinese character
# frequency ranking, Jun Da corpus order). The first 500 distinct ones are used.
COMMON_SC = (
    "的一是不了在人有我他这个们中来上大为和国地到以说时要就出会可也你对生能而子那得于着下"
    "自之年过发后作里用道行所然家种事成方多经么去法学如都同现当没动面起看定天分还进好小部"
    "其些主样理心她本前开但因只从想实日军者意无力它与长把机十民第公此已工使情明性知全三又"
    "关点正业外将两高间由问很最重并物手应战向头文体政美相见被利什二等产或新己制身果加西斯"
    "月话合回特代内信表化老给世位次度门任常先海通教儿原东声提立及比员解水名真论处走义各入"
    "几口认条平系气题活尔更别打女变四神总何电数安少报才结反受目太量再感建务做接必场件计管"
    "期市直德资命山金指克许统区保至队形社便空决治展马科司五基眼书非则听白却界达光放强即像"
    "难且权思王象完设式色路记南品住告类求据程北边死张该交规万取拉格望觉术领共确传师观清今"
    "切院让识候带导争运笑飞风步改收根干造言联持组每济车亲极林服快办议往元英士证近失转夫令"
    "准布始怎呢存未远叫台单影具罗字爱击流备兵连调深商算质团集百需价花党华城石级整府离况亚"
    "请技际约示复病息究线似官火断精满支视消越器容照须九增研写称企八功吗包片史委乎查轻易早"
    "曾除农找装广显吧阿李标谈吃图念六引历首医局突专费号尽另周较注语仅考落青随选列武红响虽"
    "推势参希古众构房半节土投某案"
)

# Booth / trade-show / home-service vocabulary likely to appear in dynamic copy.
BOOTH_TERMS = (
    "获客询盘线索商家展会演示扫码二维码回复跟进成交转化预约报价客户增长销售智能体代理助手"
    "自动人工接管审批审核草稿发送暂停播放重置返回下一步开始结束完成取消关闭了解更多联系邮箱"
    "电话微信网站店铺地址评价好评广告视频帖子社交媒体品牌套餐价格免费试用开通离线网络屏幕"
    "手机平板电脑窗口装修水电清洁搬家维修空调管道屋顶园艺宠物美容摄影窗帘遮阳地板油漆门窗"
    "安装家政保洁除虫锁匠电工草坪泳池车库厨房浴室秒钟小时周月年元万亿加拿大温哥华多伦多"
    "广州深圳上海北京香港英文中文语言切换隐私安全授权合规拒绝同意确认已读未读在线忙碌稍后"
    "，。、：；！？（）《》「」『』【】〈〉…—·"
)


def log(msg):
    print(msg, flush=True)


def in_cjk(cp):
    # skip unassigned code points (e.g. the U+9FFF end of a /[\u4e00-\u9fff]/ regex range)
    return (any(lo <= cp <= hi for lo, hi in CJK_RANGES)
            and unicodedata.category(chr(cp)) != "Cn")


def common_set():
    out = []
    for ch in COMMON_SC:
        if in_cjk(ord(ch)) and ch not in out:
            out.append(ch)
    return out[:500]


ESCAPE_RES = [
    (re.compile(r"\\u\{([0-9a-fA-F]{4,6})\}"), 16),
    (re.compile(r"\\u([0-9a-fA-F]{4})"), 16),
    (re.compile(r"&#[xX]([0-9a-fA-F]+);"), 16),
    (re.compile(r"&#([0-9]+);"), 10),
]


def in_symbols(cp):
    return (any(lo <= cp <= hi for lo, hi in SYMBOL_RANGES)
            and unicodedata.category(chr(cp)) != "Cn")


def scan_pages(pred=in_cjk):
    """Return (set_of_chars, list_of_files) for chars matching pred (default: CJK) in the booth sources."""
    chars, files = set(), []
    for pattern in SCAN_GLOBS:
        for path in sorted(glob.glob(os.path.join(BOOTH, pattern))):
            if not os.path.isfile(path):
                continue
            try:
                text = open(path, encoding="utf-8", errors="replace").read()
            except OSError:
                continue
            files.append(os.path.relpath(path, BOOTH))
            found = {c for c in text if pred(ord(c))}
            # also decode \uXXXX / \u{XXXX} / &#x...; / &#...; escapes
            for rx, base in ESCAPE_RES:
                for m in rx.finditer(text):
                    try:
                        cp = int(m.group(1), base)
                    except ValueError:
                        continue
                    if 0 <= cp <= 0x10FFFF and pred(cp):
                        found.add(chr(cp))
            chars |= found
    return chars, files


def wanted_chars():
    page_chars, files = scan_pages()
    allc = set(page_chars) | set(common_set()) | {c for c in BOOTH_TERMS if in_cjk(ord(c))}
    return sorted(allc), page_chars, files


# ---------------------------------------------------------------- network

def fetch(url, binary=False, tries=3):
    last = None
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=90) as r:
                data = r.read()
            return data if binary else data.decode("utf-8")
        except Exception as e:  # noqa: BLE001 — retry on anything network-ish
            last = e
            time.sleep(1.5 * (i + 1))
    raise RuntimeError("GET failed after %d tries: %s (%s)" % (tries, url[:140], last))


def css_url(query, text=None):
    q = "family=" + urllib.parse.quote(query, safe=":,@;.").replace("%20", "+")
    if text is not None:
        q += "&text=" + urllib.parse.quote(text, safe="")
    return API + "?" + q + "&display=swap"


FACE_RE = re.compile(r"(?:/\*\s*([\w-]+)\s*\*/\s*)?@font-face\s*\{([^}]*)\}", re.S)


def parse_faces(css):
    faces = []
    for m in FACE_RE.finditer(css):
        body = m.group(2)
        props = {}
        for decl in body.split(";"):
            if ":" in decl:
                k, v = decl.split(":", 1)
                props[k.strip().lower()] = v.strip()
        um = re.search(r"url\(([^)]+)\)", props.get("src", ""))
        faces.append({
            "subset": m.group(1),
            "family": props.get("font-family", "").strip("'\""),
            "style": props.get("font-style", "normal"),
            "weight": props.get("font-weight", "400"),
            "stretch": props.get("font-stretch"),
            "url": um.group(1).strip("'\"") if um else None,
            "range": props.get("unicode-range"),
        })
    return faces


def face_css(family, local_file, style, weight, stretch=None, urange=None, comment=None):
    lines = []
    if comment:
        lines.append("/* %s */" % comment)
    lines.append("@font-face {")
    lines.append('  font-family: "%s";' % family)
    lines.append("  font-style: %s;" % style)
    lines.append("  font-weight: %s;" % weight)
    if stretch:
        lines.append("  font-stretch: %s;" % stretch)
    lines.append("  font-display: swap;")
    lines.append('  src: url(fonts/%s) format("woff2");' % local_file)
    if urange:
        lines.append("  unicode-range: %s;" % urange)
    lines.append("}")
    return "\n".join(lines)


def save_bytes(path, data):
    tmp = path + ".tmp"
    with open(tmp, "wb") as f:
        f.write(data)
    os.replace(tmp, path)


def check_woff2(data, what):
    if data[:4] != b"wOF2":
        raise RuntimeError("%s is not woff2 (got %r) — did the API ignore the UA?" % (what, data[:4]))


# ---------------------------------------------------------------- fonts.css blocks

BLOCK_RE = re.compile(
    r"/\* ==== BEGIN (?P<name>[^(]+?) \(generated\) ==== \*/\n(?P<body>.*?)/\* ==== END (?P=name) ==== \*/\n?",
    re.S)


def read_blocks():
    if not os.path.exists(CSS_PATH):
        return {}
    css = open(CSS_PATH, encoding="utf-8").read()
    return {m.group("name"): m.group("body").rstrip("\n") for m in BLOCK_RE.finditer(css)}


def write_css(blocks):
    head = (
        "/*\n"
        " * Aivora booth kit — local webfonts (offline). GENERATED by tools/build-fonts.py;\n"
        " * edit the script, not this file. Re-run after page copy changes:\n"
        " *   python3 designs/aivora-v2-exchange/booth/tools/build-fonts.py\n"
        " * Fonts: SIL Open Font License 1.1, see fonts/OFL.txt.\n"
        " */\n"
    )
    parts = [head]
    for name in BLOCK_ORDER:
        if name in blocks:
            parts.append("\n/* ==== BEGIN %s (generated) ==== */\n%s\n/* ==== END %s ==== */\n"
                         % (name, blocks[name].strip("\n"), name))
    tmp = CSS_PATH + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        f.write("".join(parts))
    os.replace(tmp, CSS_PATH)


def block_files(body):
    return re.findall(r"url\(fonts/([^)]+)\)", body or "")


# ---------------------------------------------------------------- latin families

def build_latin(fam, force):
    blocks = read_blocks()
    body = blocks.get(fam["name"])
    if body and not force and all(os.path.exists(os.path.join(FONTS_DIR, f)) for f in block_files(body)):
        log("  %-14s up to date (%d files) — use --refresh-latin to re-download"
            % (fam["name"], len(block_files(body))))
        return body
    css = fetch(css_url(fam["query"]))
    faces = [f for f in parse_faces(css) if f["subset"] in fam["subsets"]]
    if not faces:
        raise RuntimeError("no %s faces for subsets %s" % (fam["name"], fam["subsets"]))
    out = []
    for f in faces:
        variable = " " in f["weight"]
        name = fam["slug"]
        if f["style"] != "normal":
            name += "-" + f["style"]
        if not variable:
            name += "-" + f["weight"]
        name += "-" + f["subset"] + ".woff2"
        data = fetch(f["url"], binary=True)
        check_woff2(data, name)
        save_bytes(os.path.join(FONTS_DIR, name), data)
        out.append(face_css(fam["name"], name, f["style"], f["weight"], f["stretch"], f["range"], f["subset"]))
        log("  %-14s %-34s %7d B" % (fam["name"], name, len(data)))
    return "\n".join(out)


# ---------------------------------------------------------------- Noto Sans SC subset

def font_info(data):
    """(cmap codepoints, (wght_min, wght_max) or None) via fontTools if available."""
    try:
        from fontTools.ttLib import TTFont  # type: ignore
    except Exception:  # noqa: BLE001
        return None, None
    try:
        tt = TTFont(io.BytesIO(data))
        cmap = set(tt.getBestCmap().keys())
        wght = None
        if "fvar" in tt:
            for ax in tt["fvar"].axes:
                if ax.axisTag == "wght":
                    wght = (int(ax.minValue), int(ax.maxValue))
        return cmap, wght
    except Exception:  # noqa: BLE001 — verification is best-effort
        return None, None


def to_ranges(cps):
    cps = sorted(cps)
    out, i = [], 0
    while i < len(cps):
        j = i
        while j + 1 < len(cps) and cps[j + 1] == cps[j] + 1:
            j += 1
        out.append("U+%04X" % cps[i] if i == j else "U+%04X-%04X" % (cps[i], cps[j]))
        i = j + 1
    return ", ".join(out)


def fetch_cjk_chunk(chars):
    """Return list of (bytes, faces) — splits the chunk if the API refuses to subset it."""
    css = fetch(css_url(CJK_FAMILY["query"], "".join(chars)))
    faces = parse_faces(css)
    urls = {f["url"] for f in faces if f["url"]}
    subsetted = len(urls) == 1 and "/l/font" in next(iter(urls))
    if not subsetted:
        if len(chars) <= 25:
            raise RuntimeError("Google Fonts would not subset Noto Sans SC (got %d files)" % len(urls))
        mid = len(chars) // 2
        log("    API returned the unsubsetted font for %d chars; splitting" % len(chars))
        return fetch_cjk_chunk(chars[:mid]) + fetch_cjk_chunk(chars[mid:])
    data = fetch(next(iter(urls)), binary=True)
    check_woff2(data, "Noto Sans SC subset")
    return [(data, faces, chars)]


def build_cjk(chunk_size):
    chars, page_chars, files = wanted_chars()
    log("  scanned %d file(s): %d distinct CJK chars on pages; %d chars total with safety set"
        % (len(files), len(page_chars), len(chars)))
    n = max(1, -(-len(chars) // chunk_size))
    size = -(-len(chars) // n)
    pieces = []
    for k in range(n):
        pieces += fetch_cjk_chunk(chars[k * size:(k + 1) * size])

    rules, new_files, missing = [], [], []
    for idx, (data, faces, chunk) in enumerate(pieces):
        digest = hashlib.sha1(data).hexdigest()[:10]
        name = "%s-%d-%s.woff2" % (CJK_FAMILY["slug"], idx, digest)
        save_bytes(os.path.join(FONTS_DIR, name), data)
        new_files.append(name)
        cmap, wght = font_info(data)
        if cmap is not None:
            missing += [c for c in chunk if ord(c) not in cmap]
        weights = sorted({int(w) for f in faces for w in f["weight"].split()})
        if wght:  # one variable file serves every requested weight
            weight = "%d %d" % wght
        elif len(weights) > 1:
            weight = "%d %d" % (weights[0], weights[-1])
        else:
            weight = str(weights[0]) if weights else "400"
        urange = faces[0]["range"] or to_ranges(ord(c) for c in chunk)
        rules.append(face_css(CJK_FAMILY["name"], name, "normal", weight, None, urange,
                              "subset %d/%d — %d chars" % (idx + 1, len(pieces), len(chunk))))
        log("  %-14s %-34s %7d B  (%d chars, wght %s)" % (CJK_FAMILY["name"], name, len(data), len(chunk), weight))
    if missing:
        log("  ! %d char(s) not in Noto Sans SC (will fall back to system font): %s"
            % (len(missing), "".join(missing)))
    return "\n".join(rules), new_files, chars


def parse_urange(value):
    cps = set()
    for part in (value or "").split(","):
        part = part.strip().upper().replace("U+", "")
        if not part or "?" in part:
            continue
        if "-" in part:
            lo, hi = part.split("-", 1)
            cps.update(range(int(lo, 16), int(hi, 16) + 1))
        else:
            cps.add(int(part, 16))
    return cps


def block_ranges(body):
    cps = set()
    for value in re.findall(r"unicode-range:\s*([^;]+);", body or ""):
        cps |= parse_urange(value)
    return cps


def wanted_symbols(archivo_body):
    """Symbols used on the pages (+ a small safety set) that the Archivo slices do not cover."""
    page_syms, _ = scan_pages(in_symbols)
    covered = block_ranges(archivo_body)
    return sorted(c for c in set(page_syms) | set(SYMBOL_SAFETY) if ord(c) not in covered), page_syms


def build_symbols(archivo_body):
    """Return (css body or None, [file names], requested chars) for the Archivo symbols face."""
    want, page_syms = wanted_symbols(archivo_body)
    log("  %d symbol char(s) on pages outside Archivo's latin slices; requesting %d: %s"
        % (len(page_syms), len(want), "".join(want)))
    if not want:
        return None, [], want
    css = fetch(css_url(SYMBOL_FACE["query"], "".join(want)))
    faces = parse_faces(css)
    urls = {f["url"] for f in faces if f["url"]}
    if len(urls) != 1:
        raise RuntimeError("expected one Archivo symbols file, got %d" % len(urls))
    data = fetch(next(iter(urls)), binary=True)
    check_woff2(data, "Archivo symbols subset")
    cmap, _ = font_info(data)
    have = [c for c in want if cmap is None or ord(c) in cmap]
    if cmap is not None and len(have) < len(want):
        log("  ! not in Archivo (will fall back to the next font in the stack): %s"
            % "".join(c for c in want if c not in have))
    if not have:
        return None, [], want
    name = "%s-%s.woff2" % (SYMBOL_FACE["slug"], hashlib.sha1(data).hexdigest()[:10])
    save_bytes(os.path.join(FONTS_DIR, name), data)
    f = faces[0]
    body = face_css(SYMBOL_FACE["family"], name, f["style"], f["weight"], f["stretch"],
                    to_ranges(ord(c) for c in have), "symbols — %d chars" % len(have))
    log("  %-14s %-34s %7d B  (%d chars, wght %s)" % (SYMBOL_FACE["name"], name, len(data), len(have), f["weight"]))
    return body, [name], want


def cleanup_stale(slug, keep):
    for path in glob.glob(os.path.join(FONTS_DIR, slug + "-*.woff2")):
        if os.path.basename(path) not in keep:
            os.remove(path)
            log("  removed stale %s" % os.path.basename(path))


# ---------------------------------------------------------------- main

def total_size():
    return sum(os.path.getsize(p) for p in glob.glob(os.path.join(FONTS_DIR, "*.woff2")))


def check_only():
    page_chars, files = scan_pages()
    have = set(open(CHARS_PATH, encoding="utf-8").read()) if os.path.exists(CHARS_PATH) else set()
    missing = sorted(c for c in page_chars if c not in have)
    log("scanned %d file(s), %d distinct CJK chars on pages" % (len(files), len(page_chars)))
    # symbols: covered by the Archivo slices, or already requested for the symbols face
    want_syms, page_syms = wanted_symbols(read_blocks().get(LATIN_FAMILIES[0]["name"]))
    have_syms = set(open(SYMBOLS_PATH, encoding="utf-8").read()) if os.path.exists(SYMBOLS_PATH) else set()
    missing += sorted(c for c in want_syms if c in page_syms and c not in have_syms)
    if missing:
        log("NOT COVERED (%d): %s\n-> re-run build-fonts.py" % (len(missing), "".join(missing)))
        return 1
    log("all page characters are covered by the current Noto Sans SC / Archivo symbols subsets")
    return 0


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--check", action="store_true", help="offline: verify page chars are covered, no downloads")
    ap.add_argument("--refresh-latin", action="store_true", help="re-download Archivo / IBM Plex Mono / Doto")
    ap.add_argument("--skip-cjk", action="store_true",
                    help="do not rebuild the page-dependent subsets (Noto Sans SC, Archivo symbols)")
    ap.add_argument("--chunk", type=int, default=DEFAULT_CHUNK, help="chars per text= request (default 400)")
    args = ap.parse_args()

    if args.check:
        return check_only()

    os.makedirs(FONTS_DIR, exist_ok=True)
    blocks = read_blocks()

    log("latin families:")
    for fam in LATIN_FAMILIES:
        blocks[fam["name"]] = build_latin(fam, args.refresh_latin)
        write_css(blocks)  # persist progress per family

    if not args.skip_cjk:
        log("Archivo symbols:")
        body, files, syms = build_symbols(blocks.get(LATIN_FAMILIES[0]["name"]))
        if body:
            blocks[SYMBOL_FACE["name"]] = body
        else:
            blocks.pop(SYMBOL_FACE["name"], None)
        write_css(blocks)
        with open(SYMBOLS_PATH, "w", encoding="utf-8") as f:
            f.write("".join(syms) + "\n")
        cleanup_stale(SYMBOL_FACE["slug"], set(files))

        log("Noto Sans SC subset:")
        body, files, chars = build_cjk(max(25, args.chunk))
        blocks[CJK_FAMILY["name"]] = body
        write_css(blocks)
        with open(CHARS_PATH, "w", encoding="utf-8") as f:
            f.write("".join(chars) + "\n")
        cleanup_stale(CJK_FAMILY["slug"], set(files))

    css = open(CSS_PATH, encoding="utf-8").read()
    remote = re.findall(r"url\((?!fonts/)[^)]*\)", css)
    if remote:
        log("! fonts.css has non-local URLs: %s" % remote)
        return 1
    for f in set(re.findall(r"url\(fonts/([^)]+)\)", css)):
        if not os.path.exists(os.path.join(FONTS_DIR, f)):
            log("! fonts.css references missing file fonts/%s" % f)
            return 1
    size = total_size()
    log("done: %s — %d woff2 files, %.0f KB total%s"
        % (os.path.relpath(CSS_PATH, os.getcwd()), len(glob.glob(os.path.join(FONTS_DIR, "*.woff2"))),
           size / 1024, "" if size <= SIZE_BUDGET else "  ! OVER the ~1.5 MB budget"))
    return 0


if __name__ == "__main__":
    sys.exit(main())
