import random
from datetime import date, datetime, timedelta

from worker.config import TZ
from worker.planner import plan_day
from worker.thai import clusters, visible_len, wrap

SPIRIT, NEWS = "style-spirit", "style-news"
PAGES = [
    {"id": "takiangjai", "enabled": True, "categories": ["dharma", "health"], "clips_per_day": 7,
     "post_window_start": "07:00", "post_window_end": "22:00", "style_id": SPIRIT},
    {"id": "lomtaipig", "enabled": True, "categories": ["dharma", "health", "law"], "clips_per_day": 5,
     "post_window_start": "07:00", "post_window_end": "22:00", "style_id": SPIRIT},
    {"id": "flash", "enabled": True, "categories": ["news", "law", "money", "tech"], "clips_per_day": 7,
     "post_window_start": "07:00", "post_window_end": "22:00", "style_id": NEWS},
    {"id": "thainews", "enabled": True, "categories": ["news", "law", "money"], "clips_per_day": 4,
     "post_window_start": "07:00", "post_window_end": "22:00", "style_id": NEWS},
    {"id": "fast", "enabled": True, "categories": ["news", "tech", "money"], "clips_per_day": 4,
     "post_window_start": "07:00", "post_window_end": "22:00", "style_id": NEWS},
    {"id": "off", "enabled": False, "categories": ["news"], "clips_per_day": 4,
     "post_window_start": "07:00", "post_window_end": "22:00", "style_id": NEWS},
]


def _plan(seed=1, now=None):
    day = date(2026, 11, 19)
    now = now or datetime(2026, 11, 19, 0, 30, tzinfo=TZ)
    return plan_day(PAGES, day, now, rng=random.Random(seed)), day


def test_quota_and_sharing():
    for seed in range(30):
        plan, _ = _plan(seed)
        per_page = {}
        for c in plan:
            pages = [p["page_id"] for p in c["posts"]]
            assert len(pages) == len(set(pages))
            styles = {next(x["style_id"] for x in PAGES if x["id"] == pid) for pid in pages}
            assert len(styles) == 1, "a clip is only shared between pages with the same style"
            for pid in pages:
                assert c["category"] in next(x for x in PAGES if x["id"] == pid)["categories"]
                per_page[pid] = per_page.get(pid, 0) + 1
        assert per_page == {"takiangjai": 7, "lomtaipig": 5, "flash": 7, "thainews": 4, "fast": 4}
        # Sharing means fewer renders than posts.
        assert len(plan) < sum(per_page.values())


def test_times_window_and_gaps():
    for seed in range(30):
        plan, day = _plan(seed)
        start = datetime(2026, 11, 19, 7, 0, tzinfo=TZ)
        end = datetime(2026, 11, 19, 22, 0, tzinfo=TZ)
        by_page = {}
        for c in plan:
            times = sorted(p["scheduled_at"] for p in c["posts"])
            for a, b in zip(times, times[1:]):
                assert b - a >= timedelta(minutes=20), "same clip on two pages too close together"
            for p in c["posts"]:
                assert start <= p["scheduled_at"] <= end
                by_page.setdefault(p["page_id"], []).append(p["scheduled_at"])
        for times in by_page.values():
            times.sort()
            for a, b in zip(times, times[1:]):
                assert b - a >= timedelta(minutes=20) or b == end


def test_news_produced_close_to_posting():
    plan, _ = _plan(3)
    for c in plan:
        first = min(p["scheduled_at"] for p in c["posts"])
        if c["category"] == "news":
            assert first - c["produce_after"] <= timedelta(minutes=90)
        else:
            assert c["produce_after"] == datetime(2026, 11, 19, 0, 30, tzinfo=TZ)


def test_late_start_skips_past_hours():
    now = datetime(2026, 11, 19, 15, 0, tzinfo=TZ)
    plan, _ = _plan(2, now)
    for c in plan:
        for p in c["posts"]:
            assert p["scheduled_at"] >= now + timedelta(minutes=60)


def test_thai_wrap():
    assert clusters("ที่") == ["ที่"]
    assert visible_len("สวัสดี") == 4
    lines = wrap("ก่อนนอนคืนนี้ลองทำสิ่งนี้ดูแล้วชีวิตจะดีขึ้นมาก", 10)
    assert all(visible_len(l) <= 10 for l in lines)
    for l in lines:
        assert l[0] not in "ัิีึืุู็่้๊๋์"
        assert l[-1] not in "เแโใไ"
    assert wrap("หายใจช้าๆ 3 ครั้ง|ปล่อยเรื่องค้างใจ", 18) == ["หายใจช้าๆ 3 ครั้ง", "ปล่อยเรื่องค้างใจ"]


def _run_voice_chain(secrets: dict, working: set) -> list[str]:
    """Which engines get tried, in order, when only the engines in `working` succeed and `secrets` are saved."""
    import tempfile
    from pathlib import Path

    from worker import tts

    tried = []

    def stub(name):
        def run(text, gender, rate, out):
            tried.append(name)
            if name not in working:
                raise RuntimeError("down")
            tts._silence(text, gender, rate, out)
        return run

    old_engines, old_secret = dict(tts.ENGINES), tts.db.secret
    try:
        for n in ("gemini", "azure", "openai", "edge"):
            tts.ENGINES[n] = stub(n)
        tts.db.secret = lambda key: secrets.get(key, "")
        with tempfile.TemporaryDirectory() as d:
            tts.voice_segments(["สวัสดี", "ทดสอบ"], "female", "+0%", "gemini", Path(d))
    finally:
        tts.ENGINES.clear()
        tts.ENGINES.update(old_engines)
        tts.db.secret = old_secret
    return tried


def test_voice_backup_order_free_first_paid_last():
    keys = {"azure_speech_key": "k", "openai_api_key": "k"}
    # Gemini and Azure down: the whole clip moves to OpenAI, one engine at a time, Edge is never reached.
    assert _run_voice_chain(keys, {"openai", "edge"}) == ["gemini", "azure", "openai", "openai"]
    # No backup keys saved: straight from Gemini to Edge.
    assert _run_voice_chain({}, {"edge"}) == ["gemini", "edge", "edge"]
    # Gemini works: nothing else is called.
    assert _run_voice_chain(keys, {"gemini"}) == ["gemini", "gemini"]


def test_gemini_voice_calls_are_paced_to_three_per_minute():
    from worker import tts

    clock = {"t": 1000.0}
    slept = []
    old = tts._now, tts._pause

    def pause(s):
        slept.append(round(s, 1))
        clock["t"] += s

    try:
        tts._now, tts._pause = (lambda: clock["t"]), pause
        tts._gemini_calls.clear()
        for _ in range(3):
            tts._wait_for_slot("m")
        assert slept == [], "the first three calls in a minute go straight through"
        tts._wait_for_slot("m")
        assert slept and 61 <= slept[0] <= 63, slept
        tts._wait_for_slot("other-model")
        assert len(slept) == 1, "another model has its own allowance"
    finally:
        tts._now, tts._pause = old
        tts._gemini_calls.clear()


def test_quota_wait_reads_googles_429():
    from worker import tts

    class R:
        def __init__(self, body): self.body = body
        def json(self): return self.body

    minute = {"error": {"details": [
        {"@type": "type.googleapis.com/google.rpc.QuotaFailure",
         "violations": [{"quotaId": "GenerateRequestsPerMinutePerProjectPerModel-FreeTier"}]},
        {"@type": "type.googleapis.com/google.rpc.RetryInfo", "retryDelay": "28s"}]}}
    daily = {"error": {"details": [
        {"@type": "type.googleapis.com/google.rpc.QuotaFailure",
         "violations": [{"quotaId": "GenerateRequestsPerDayPerProjectPerModel-FreeTier"}]}]}}
    assert tts._quota_wait(R(minute)) == 29.0
    assert tts._quota_wait(R(daily)) is None
    assert tts._quota_wait(R({})) == 31.0


def test_script_writer_backup_order():
    from worker import llm

    tried = []
    old_secret, old_gemini, old_compat = llm.db.secret, llm._gemini, llm._openai_compatible

    def gemini(prompt, model, temperature=0.9):
        tried.append("gemini")
        raise RuntimeError("busy")

    def compat(prompt, model, base, key, temperature=0.9):
        tried.append("groq" if "groq" in base else "openai")
        if "groq" in base:
            raise RuntimeError("limit")
        return '{"ok": true}'

    try:
        llm._gemini, llm._openai_compatible = gemini, compat
        llm.db.secret = lambda key: "k"
        assert llm.generate_json("x", {"llm": "gemini"}) == {"ok": True}
        assert tried == ["gemini", "groq", "openai"]
        tried.clear()
        llm.db.secret = lambda key: "k" if key == "gemini_api_key" else ""
        try:
            llm.generate_json("x", {"llm": "gemini"})
            raise AssertionError("should fail with only a broken Gemini key")
        except RuntimeError as e:
            assert "gemini" in str(e)
        assert tried == ["gemini"]
    finally:
        llm.db.secret, llm._gemini, llm._openai_compatible = old_secret, old_gemini, old_compat


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            fn()
            print("ok", name)
