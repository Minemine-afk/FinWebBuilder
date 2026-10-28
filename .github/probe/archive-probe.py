"""Throwaway (round 2): dated Wayback snapshots for the providers round 1 could not cover."""
import json, re, sys, time, urllib.parse, urllib.request, html as H

UA = {"User-Agent": "Mozilla/5.0 (compatible; finwebbuilder-research)"}

def get(url, tries=3):
    url = urllib.parse.quote(url, safe=":/?&=%*.-_~+,")
    for i in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=30) as r:
                return r.read().decode("utf-8", "replace")
        except Exception as e:
            print(f"   retry {i+1} {type(e).__name__}", flush=True)
            time.sleep(5 * (i + 1))
    return None

def cdx(url, prefix=False, limit=60):
    p = {"url": url, "from": "2023", "to": "2025", "output": "json", "fl": "timestamp,original", "filter": "statuscode:200", "collapse": "timestamp:6", "limit": str(limit)}
    if prefix: p["matchType"] = "prefix"
    raw = get("https://web.archive.org/cdx/search/cdx?" + urllib.parse.urlencode(p))
    time.sleep(3)
    try: return json.loads(raw)[1:] if raw else []
    except Exception: return []

LINE = re.compile(r"(?i)on average|average (price|renovation|cost)|past year|package|from s?\$|s\$\s?\d")
def show(ts, orig, maxlines=14):
    page = get(f"https://web.archive.org/web/{ts}id_/{orig}")
    time.sleep(3)
    if not page: print(f"   {ts} {orig}: fetch failed"); return
    t = re.sub(r"(?s)<(script|style).*?</\1>", " ", page)
    t = H.unescape(re.sub(r"<[^>]+>", "\n", t))
    lines = [re.sub(r"\s+", " ", l).strip() for l in t.split("\n")]
    hits = [l for l in lines if LINE.search(l) and "$" in l and len(l) < 240]
    print(f"   --- {ts[:8]} {orig[-60:]} ({len(page)//1000} KB) {len(hits)} lines")
    for l in list(dict.fromkeys(hits))[:maxlines]: print("      ", l)
    sys.stdout.flush()

def nearest_oct(stamps):
    out = []
    for y in ("2023", "2024", "2025"):
        ys = [s for s in stamps if s.startswith(y)]
        if ys: out.append(min(ys, key=lambda s: abs(int(s[4:8]) - 1031)))
    return out

targets = [
    ("starry (hometrust)", "https://www.hometrust.sg/interior-designers/starry-homestead-pte-ltd", False),
    ("u-home (qanvast)", "https://qanvast.com/sg/interior-designers-architects/u-home-interior-design-342", False),
    ("weiken (qanvast prefix)", "qanvast.com/professional/1049", True),
    ("weiken (hometrust prefix)", "hometrust.sg/interior-designers/weiken", True),
    ("carpenters (hometrust prefix)", "hometrust.sg/interior-designers/carpenters", True),
    ("carpenters (qanvast prefix)", "qanvast.com/sg/interior-designers/carpenters", True),
    ("absolook (qanvast)", "https://qanvast.com/sg/interior-designers/absolook-interior-design-439", False),
    ("absolook (hometrust prefix)", "hometrust.sg/interior-designers/absolook", True),
    ("fcid packages (prefix)", "fcinteriordesign.net/bto-renovation-packages", True),
    ("renozone (hometrust prefix)", "hometrust.sg/interior-designers/renozone", True),
]
for name, url, prefix in targets:
    print(f"\n##### {name}", flush=True)
    rows = cdx(url, prefix)
    by_orig = {}
    for ts, orig in rows: by_orig.setdefault(orig, []).append(ts)
    for orig, stamps in list(by_orig.items())[:2]:
        print("   page:", orig, "snapshots:", stamps[:40], flush=True)
        picks = nearest_oct(stamps) if len(stamps) > 3 else stamps
        for ts in picks[:4]: show(ts, orig)
