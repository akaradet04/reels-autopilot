"""Today's news: Google Trends Thailand plus Thai news RSS feeds."""

import html
import re
from datetime import datetime, timedelta, timezone
from urllib.parse import quote

import feedparser
import httpx

TRENDS_FEEDS = [
    "https://trends.google.com/trending/rss?geo=TH",
    "https://trends.google.com/trends/trendingsearches/daily/rss?geo=TH",
]
UA = {"User-Agent": "Mozilla/5.0 (compatible; ReelsAutopilot/1.0)"}


def _clean(text: str) -> str:
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", text or ""))).strip()


def _fetch(url: str):
    r = httpx.get(url, headers=UA, timeout=20, follow_redirects=True)
    r.raise_for_status()
    return feedparser.parse(r.content)


def _published(entry) -> datetime | None:
    t = entry.get("published_parsed")
    return datetime(*t[:6], tzinfo=timezone.utc) if t else None


def google_news(query: str, limit: int = 15) -> list[dict]:
    """Google News Thailand search. Titles come as 'Headline - Outlet'; the outlet is split off."""
    feed = _fetch(f"https://news.google.com/rss/search?q={quote(query)}&hl=th&gl=TH&ceid=TH:th")
    out = []
    for e in feed.entries[:limit]:
        source = _clean((e.get("source") or {}).get("title", ""))
        title = _clean(e.get("title", ""))
        if source and title.endswith(f" - {source}"):
            title = title[: -len(source) - 3]
        out.append({"title": title, "summary": "", "url": e.get("link", ""), "source": source,
                    "published": _published(e)})
    return out


def search(queries: list[str], feeds: list[str], max_age_days: int = 5, limit: int = 12) -> list[dict]:
    """Recent articles about a topic: Google News for each query, plus the saved RSS feeds filtered by the query words.
    Only real articles come back; an empty list means the story was not found."""
    items, seen = [], set()

    def add(it: dict) -> None:
        key = re.sub(r"\W+", "", it["title"])[:50]
        if key and key not in seen:
            seen.add(key)
            items.append(it)

    for q in queries[:3]:
        try:
            for it in google_news(q):
                add(it)
        except Exception:
            continue
    words = {w for q in queries for w in q.split() if len(w) >= 3}
    if words:
        for it in headlines(feeds, 60):
            if any(w in it["title"] + it["summary"] for w in words):
                it.setdefault("published", None)
                add(it)

    cutoff = datetime.now(timezone.utc) - timedelta(days=max_age_days)
    items = [it for it in items if it.get("published") is None or it["published"] >= cutoff]
    words_l = [w for q in queries for w in q.split() if len(w) >= 3]
    items.sort(key=lambda it: (-sum(w in it["title"] for w in words_l),
                               -(it["published"].timestamp() if it.get("published") else 0)))
    return items[:limit]


def trends(limit: int = 15) -> list[dict]:
    for url in TRENDS_FEEDS:
        try:
            feed = _fetch(url)
        except Exception:
            continue
        items = []
        for e in feed.entries[:limit]:
            item = {"title": _clean(e.get("title", "")), "traffic": e.get("ht_approx_traffic", ""),
                    "summary": "", "url": ""}
            # Trends entries carry the news articles that explain the trend.
            title = e.get("ht_news_item_title")
            if title:
                item["summary"] = _clean(title)
                item["url"] = e.get("ht_news_item_url", "")
            items.append(item)
        if items:
            return items
    return []


def headlines(feeds: list[str], per_feed: int = 10) -> list[dict]:
    items = []
    for url in feeds:
        try:
            feed = _fetch(url)
        except Exception:
            continue
        for e in feed.entries[:per_feed]:
            items.append({
                "title": _clean(e.get("title", "")),
                "summary": _clean(e.get("summary", ""))[:400],
                "url": e.get("link", ""),
                "source": _clean(feed.feed.get("title", url)),
            })
    return items
