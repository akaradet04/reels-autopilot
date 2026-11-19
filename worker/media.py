"""Background footage from free stock libraries: Pexels and Pixabay, whichever has a saved key.

Landscape footage is fine: the renderer crops the centre to 9:16.
"""

import random
from pathlib import Path

import httpx

from worker import db


def _download(url: str, out: Path) -> Path:
    with httpx.stream("GET", url, timeout=180, follow_redirects=True) as r:
        r.raise_for_status()
        with open(out, "wb") as f:
            for chunk in r.iter_bytes():
                f.write(chunk)
    return out


# ─── Pexels ──────────────────────────────────────────────────────────────────

def _pexels(path: str, params: dict) -> dict:
    r = httpx.get(f"https://api.pexels.com{path}", headers={"Authorization": db.secret("pexels_api_key")},
                  params=params, timeout=30)
    r.raise_for_status()
    return r.json()


def _pexels_file(video: dict) -> dict | None:
    files = [f for f in video.get("video_files", [])
             if f.get("height") and f.get("width") and f["height"] > f["width"] and f["height"] >= 1280]
    return min(files, key=lambda f: abs(f["height"] - 1920)) if files else None


def pexels_video(kw: str, out: Path, rng: random.Random) -> tuple[Path, str] | None:
    data = _pexels("/videos/search", {"query": kw, "orientation": "portrait", "per_page": 15, "page": rng.randint(1, 3)})
    vids = [v for v in data.get("videos", []) if v.get("duration", 0) >= 6]
    rng.shuffle(vids)
    for v in vids:
        f = _pexels_file(v)
        if f:
            return _download(f["link"], out), f"Video by {v.get('user', {}).get('name', 'Pexels')} on Pexels"
    return None


def pexels_photo(kw: str, out: Path, rng: random.Random) -> tuple[Path, str] | None:
    data = _pexels("/v1/search", {"query": kw, "orientation": "portrait", "per_page": 15, "page": rng.randint(1, 3)})
    photos = data.get("photos", [])
    if not photos:
        return None
    p = rng.choice(photos)
    return _download(p["src"]["portrait"], out), f"Photo by {p.get('photographer', 'Pexels')} on Pexels"


# ─── Pixabay ─────────────────────────────────────────────────────────────────

def _pixabay(path: str, params: dict) -> dict:
    r = httpx.get(f"https://pixabay.com/api/{path}", params={"key": db.secret("pixabay_api_key"),
                                                            "safesearch": "true", **params}, timeout=30)
    r.raise_for_status()
    return r.json()


LONG_CLIP_SEC = 15


def _sharp_after_crop(f: dict) -> bool:
    """The clip is 1080x1920. A landscape source is cropped to its middle, keeping its full height, so it needs
    height >= 1920 (4K) to stay sharp; a portrait source needs width >= 1080. Anything smaller gets upscaled and looks soft."""
    return f["height"] >= 1920 if f["width"] >= f["height"] else f["width"] >= 1080


def pixabay_video(kw: str, out: Path, rng: random.Random) -> tuple[Path, str] | None:
    hits = [h for h in _pixabay("videos/", {"q": kw, "per_page": 50}).get("hits", []) if h.get("duration", 0) >= 6]
    rng.shuffle(hits)
    # Rank (lower is better): a long clip loops less often, so it matters more than portrait vs landscape.
    # 0 long sharp portrait, 1 long sharp landscape, 2 short sharp portrait, 3 short sharp landscape, 4 soft fallback.
    best = None  # (rank, file, hit)
    for h in hits:
        files = [f for f in (h.get("videos") or {}).values() if f.get("url") and f.get("height")]
        sharp = [f for f in files if _sharp_after_crop(f)]
        if sharp:
            f = min(sharp, key=lambda x: x.get("size") or x["width"] * x["height"])  # smallest file that is still sharp
            rank = (0 if h.get("duration", 0) >= LONG_CLIP_SEC else 2) + (0 if f["height"] > f["width"] else 1)
        elif files:
            f, rank = max(files, key=lambda x: x["height"]), 4
        else:
            continue
        if best is None or rank < best[0]:
            best = (rank, f, h)
        if rank == 0:
            break
    if best is None:
        return None
    _, f, h = best
    return _download(f["url"], out), f"Video by {h.get('user', 'Pixabay')} on Pixabay"


def pixabay_photo(kw: str, out: Path, rng: random.Random) -> tuple[Path, str] | None:
    hits = _pixabay("", {"q": kw, "image_type": "photo", "orientation": "vertical", "per_page": 20}).get("hits", [])
    if not hits:
        return None
    h = rng.choice(hits)
    return _download(h["largeImageURL"], out), f"Photo by {h.get('user', 'Pixabay')} on Pixabay"


# ─── Public ──────────────────────────────────────────────────────────────────

def _sources() -> list[tuple[str, dict]]:
    found = []
    if db.secret("pexels_api_key"):
        found.append(("Pexels", {"video": pexels_video, "photo": pexels_photo}))
    if db.secret("pixabay_api_key"):
        found.append(("Pixabay", {"video": pixabay_video, "photo": pixabay_photo}))
    return found


def background(kind: str, keywords: list[str], work: Path, rng: random.Random) -> tuple[Path, str, str]:
    """Returns (file, 'video' | 'photo', credit). Tries the preferred kind first, every source, then the other kind."""
    sources = _sources()
    if not sources:
        raise RuntimeError("ยังไม่ได้ใส่คีย์ Pixabay หรือ Pexels ในหน้าตั้งค่า")
    keywords = [k for k in keywords if k] + ["sky clouds", "nature landscape"]
    order = ["video", "photo"] if kind == "video" else ["photo", "video"]
    errors = []
    for k in order:
        out = work / f"bg.{'mp4' if k == 'video' else 'jpg'}"
        for name, fns in sources:
            for kw in keywords:
                try:
                    got = fns[k](kw, out, rng)
                except httpx.HTTPError as e:
                    errors.append(f"{name}: {e}")
                    break
                if got:
                    return got[0], k, got[1]
    raise RuntimeError("หาพื้นหลังไม่ได้ " + ("; ".join(errors[:3]) if errors else "ไม่พบภาพที่ตรงคำค้น"))
