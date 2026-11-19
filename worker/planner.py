"""Daily plan: decide which clips to make and when each page posts them.

One clip is shared by every page that uses the same style and wants the same category,
so a clip is rendered once and posted to several pages at different times.
"""

import random
from datetime import date, datetime, time, timedelta

from worker.config import TZ

NEWS_LEAD = timedelta(minutes=90)
MIN_PAGE_GAP = timedelta(minutes=20)
START_DELAY = timedelta(minutes=60)


def _window(page: dict, day: date, now: datetime) -> tuple[datetime, datetime] | None:
    start = datetime.combine(day, _t(page["post_window_start"]), TZ)
    end = datetime.combine(day, _t(page["post_window_end"]), TZ)
    start = max(start, now + START_DELAY)
    if end - start < timedelta(minutes=30):
        return None
    return start, end


def _t(v) -> time:
    if isinstance(v, time):
        return v
    hh, mm = str(v).split(":")[:2]
    return time(int(hh), int(mm))


def plan_day(pages: list[dict], day: date, now: datetime, max_per_page: int = 8,
             gap: tuple[int, int] = (20, 40), rng: random.Random | None = None) -> list[dict]:
    rng = rng or random.Random()
    windows, remaining, used = {}, {}, {}
    for p in pages:
        if not p.get("enabled") or not p.get("categories"):
            continue
        w = _window(p, day, now)
        if not w:
            continue
        windows[p["id"]] = w
        remaining[p["id"]] = min(int(p["clips_per_day"]), max_per_page)
        used[p["id"]] = {c: 0 for c in p["categories"]}
    by_id = {p["id"]: p for p in pages if p["id"] in windows}

    # 1. Decide clips and which pages share each one.
    clips = []
    while any(v > 0 for v in remaining.values()):
        top = max(remaining.values())
        lead = rng.choice([pid for pid, v in remaining.items() if v == top])
        counts = used[lead]
        low = min(counts.values())
        cat = rng.choice([c for c, n in counts.items() if n == low])
        style = by_id[lead].get("style_id")
        group = [pid for pid in by_id
                 if remaining[pid] > 0 and cat in by_id[pid]["categories"]
                 and by_id[pid].get("style_id") == style]
        for pid in group:
            remaining[pid] -= 1
            used[pid][cat] += 1
        clips.append({"category": cat, "style_id": style, "pages": group, "posts": {}})

    # 2. Spread each page's clips evenly across its posting window.
    for pid, (start, end) in windows.items():
        mine = [c for c in clips if pid in c["pages"]]
        if not mine:
            continue
        slot = (end - start) / len(mine)
        for k, c in enumerate(mine):
            jitter = timedelta(minutes=rng.uniform(-0.2, 0.2) * slot.total_seconds() / 60)
            c["posts"][pid] = start + slot * (k + 0.5) + jitter

    # 3. The same clip never goes out on two pages close together.
    for c in clips:
        order = sorted(c["posts"].items(), key=lambda kv: kv[1])
        for i in range(1, len(order)):
            prev_t = order[i - 1][1]
            pid, t = order[i]
            if t - prev_t < timedelta(minutes=gap[0]):
                order[i] = (pid, prev_t + timedelta(minutes=rng.randint(gap[0], gap[1])))
        c["posts"] = dict(order)

    # 4. Keep a minimum gap between posts on the same page and stay inside the window.
    for pid, (start, end) in windows.items():
        mine = sorted((c for c in clips if pid in c["posts"]), key=lambda c: c["posts"][pid])
        last = None
        for c in mine:
            t = c["posts"][pid]
            if last and t - last < MIN_PAGE_GAP:
                t = last + MIN_PAGE_GAP
            c["posts"][pid] = min(t, end)
            last = c["posts"][pid]

    result = []
    for c in clips:
        first = min(c["posts"].values())
        produce_after = max(now, first - NEWS_LEAD) if c["category"] == "news" else now
        result.append({
            "category": c["category"],
            "style_id": c["style_id"],
            "produce_after": produce_after,
            "posts": [{"page_id": pid, "scheduled_at": t} for pid, t in c["posts"].items()],
        })
    return result
