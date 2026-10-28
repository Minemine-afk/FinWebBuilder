"""Throwaway: list dated Wayback snapshots (2023-2025) of each renovation provider's pages and print the price lines in them."""
import json, re, sys, time, urllib.parse, urllib.request

UA = {"User-Agent": "Mozilla/5.0 (compatible; finwebbuilder-research)"}
spec = json.load(open("data/calculators/hdb-renovation-cost.json"))
urls = {}
for p in spec["providers"]["options"]:
    for u in {p["source"]["url"], p.get("url")}:
        if u: urls.setdefault(p["id"], []).append(u)

def get(url, tries=4):
    for i in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r:
                return r.read().decode("utf-8", "replace")
        except Exception as e:
            print(f"   retry {i+1} {type(e).__name__} {e}", flush=True)
            time.sleep(10 * (i + 1))
    return None

PRICE = re.compile(r"(?i)(s?\$\s?\d[\d,]*(?:\.\d+)?\s?[kK]?)")
for pid, us in urls.items():
    for u in us:
        print(f"\n##### {pid} {u}", flush=True)
        q = "https://web.archive.org/cdx/search/cdx?" + urllib.parse.urlencode({"url": u, "from": "2023", "to": "2025", "output": "json", "fl": "timestamp,statuscode", "filter": "statuscode:200", "collapse": "timestamp:6", "limit": "40"})
        raw = get(q)
        time.sleep(3)
        if not raw:
            print("   CDX unreachable"); continue
        try: rows = json.loads(raw)[1:]
        except Exception: print("   CDX said:", raw[:200]); continue
        stamps = [r[0] for r in rows]
        print("   snapshots:", stamps, flush=True)
        # one snapshot per year-half: earliest of each year and the latest of each year
        pick = []
        for y in ("2023", "2024", "2025"):
            ys = [s for s in stamps if s.startswith(y)]
            if ys: pick += [ys[0], ys[-1]] if len(ys) > 1 else ys
        for ts in dict.fromkeys(pick):
            html = get(f"https://web.archive.org/web/{ts}id_/{u}")
            time.sleep(4)
            if not html: print(f"   {ts}: fetch failed"); continue
            text = re.sub(r"(?s)<(script|style).*?</\1>", " ", html)
            text = re.sub(r"<[^>]+>", "\n", text)
            lines = [re.sub(r"\s+", " ", l).strip() for l in text.split("\n")]
            hits = [l for l in lines if PRICE.search(l) and re.search(r"(?i)4[- ]?room|average|package|BTO|HDB|from|renovation", l) and len(l) < 260]
            print(f"   --- {ts[:8]} ({len(html)//1000} KB) {len(hits)} price lines")
            for l in list(dict.fromkeys(hits))[:14]: print("      ", l)
            sys.stdout.flush()
