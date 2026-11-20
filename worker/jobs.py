"""One tick of the worker. Runs every 30 minutes; each step is safe to repeat."""

import html
import logging
import random
import shutil
import time
from datetime import date, datetime, timedelta

import httpx

from worker import db, facebook, media, render, scriptwriter, telegram, tts
from worker.categories import CATEGORIES, label
from worker.config import MAX_ATTEMPTS, PRODUCE_BUDGET_SEC, TZ, WORK_DIR
from worker.crypto import decrypt
from worker.planner import plan_day

log = logging.getLogger("worker")

OPEN = ["scheduled", "notified", "awaiting_approval", "pending", "posting"]
DEFAULT_STYLE = {"hook_color": "#FF2A2A", "keyword_color": "#FF9500", "body_color": "#FFFFFF",
                 "cta_color": "#FFE066", "background": "video", "voice": "female", "voice_rate": "+0%",
                 "duration": 45, "show_logo": False, "dim": 0.3}


THAI_MONTHS = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."]


def thai_stamp(when: datetime) -> str:
    """'19 พ.ย. 16:15 น.' in Bangkok time: when the news was checked, shown on the clip."""
    t = when.astimezone(TZ)
    return f"{t.day} {THAI_MONTHS[t.month - 1]} {t:%H:%M} น."


def _dt(v: str) -> datetime:
    return datetime.fromisoformat(v.replace("Z", "+00:00")).astimezone(TZ)


def _hm(v: str) -> str:
    return _dt(v).strftime("%H:%M")


def _esc(s) -> str:
    return html.escape(str(s or ""))


FREE_EGRESS_BYTES = 5 * 1024 ** 3  # Supabase free plan, per billing cycle
DEFAULT_POST_BYTES = 7 * 1024 ** 2  # until real sizes are known


def cycle_start(now: datetime, billing_day: int) -> str:
    """First day of the current Supabase billing cycle (the cycle restarts on billing_day each month)."""
    d = now.date()
    if d.day >= billing_day:
        return d.replace(day=billing_day).isoformat()
    first = d.replace(day=1) - timedelta(days=1)
    return first.replace(day=min(billing_day, 28)).isoformat()


class Tick:
    def __init__(self):
        self.now = datetime.now(TZ)
        self.s = db.settings()
        self.state = dict(self.s.get("worker_state") or {})
        self.chat = self.s.get("telegram_chat_id")
        self.auto = bool(self.s.get("automation_enabled", True))
        self.providers = self.s.get("providers") or {}
        self.approval_cats = set(self.s.get("approval_categories") or [])
        self.page_captions = self.s.get("page_captions") or {}
        self.banned = [w for w in (self.s.get("banned_terms") or []) if isinstance(w, str)]
        self.ab_on = bool(self.s.get("ab_test_hooks", False))
        self.learning_on = bool(self.s.get("learning_enabled", True))
        self.billing_day = int(self.s.get("billing_day") or 18)
        self.usage = self._usage()
        self.state["usage"] = self.usage

    def _usage(self) -> dict:
        u = dict(self.state.get("usage") or {})
        start = cycle_start(self.now, self.billing_day)
        if u.get("cycle") != start:
            u = {"cycle": start, "egress_bytes": 0, "posts": 0, "daily": {}}
        return u

    def add_egress(self, n: int) -> None:
        today = self.now.date().isoformat()
        self.usage["egress_bytes"] = int(self.usage.get("egress_bytes", 0)) + n
        self.usage["posts"] = int(self.usage.get("posts", 0)) + 1
        daily = dict(self.usage.get("daily") or {})
        daily[today] = int(daily.get(today, 0)) + n
        self.usage["daily"] = dict(sorted(daily.items())[-35:])
        self.state["usage"] = self.usage

    def daily_post_budget(self) -> tuple[int, int] | None:
        """(bytes allowed today, bytes per post) so the month stays under the chosen share of free egress."""
        pct = int(self.s.get("egress_budget_pct") or 70)
        if pct >= 100:
            return None
        budget = FREE_EGRESS_BYTES * pct / 100
        used = int(self.usage.get("egress_bytes", 0))
        start = datetime.fromisoformat(self.usage["cycle"]).date()
        nxt = date(start.year + (start.month == 12), start.month % 12 + 1, min(self.billing_day, 28))
        days_left = max(1, (nxt - self.now.date()).days)
        posts = int(self.usage.get("posts", 0))
        per_post = used // posts if posts >= 5 else DEFAULT_POST_BYTES
        return max(0, int((budget - used) / days_left)), max(per_post, 1)

    def alert(self, text: str) -> None:
        log.warning(text)
        try:
            telegram.send(self.chat, f"⚠️ {text}")
        except Exception as e:
            log.error("Telegram alert failed: %s", e)

    def run(self) -> None:
        for name, step in [("tokens", self.check_tokens), ("plan", self.plan), ("produce", self.produce),
                           ("notify", self.notify), ("publish", self.publish), ("delete", self.deletions),
                           ("stats", self.stats), ("summary", self.summary), ("cleanup", self.cleanup)]:
            try:
                step()
            except Exception as e:
                log.exception("step %s failed", name)
                self.alert(f"ขั้น {name} ล้มเหลว: {_esc(e)}")
        db.set_setting("worker_state", {**self.state, "last_tick": self.now.isoformat()})

    # ── Facebook keys ────────────────────────────────────────────────────────

    def connections(self, page_id: str) -> list[dict]:
        rows = (db.table("fb_connections").select("id,token_enc,role,fb_user_name")
                .eq("page_id", page_id).eq("status", "ok").execute().data)
        return sorted(rows, key=lambda r: r["role"] != "primary")

    def mark_invalid(self, conn: dict, page_name: str, err: Exception) -> None:
        db.table("fb_connections").update({"status": "invalid", "last_checked_at": self.now.isoformat()}) \
            .eq("id", conn["id"]).execute()
        self.alert(f"กุญแจ Facebook ของ {_esc(conn.get('fb_user_name'))} ใช้กับเพจ {_esc(page_name)} ไม่ได้แล้ว "
                   f"({_esc(err)}) เข้าเว็บแล้วกดเชื่อมต่อ Facebook ใหม่")

    def check_tokens(self) -> None:
        today = self.now.date().isoformat()
        if self.state.get("token_check_date") == today or self.now.hour < 6:
            return
        pages = db.table("pages").select("id,fb_page_id,name").execute().data
        for p in pages:
            conns = self.connections(p["id"])
            if not conns:
                self.alert(f"เพจ {_esc(p['name'])} ไม่มีกุญแจ Facebook ที่ใช้ได้ ระบบจะโพสต์เพจนี้ไม่ได้")
            for c in conns:
                try:
                    info = facebook.page_info(p["fb_page_id"], decrypt(c["token_enc"]))
                    db.table("fb_connections").update({"last_checked_at": self.now.isoformat()}).eq("id", c["id"]).execute()
                    followers = info.get("followers_count") or info.get("fan_count")
                    if followers is not None:
                        try:
                            db.table("page_stats").upsert({"page_id": p["id"], "day": today, "followers": followers}).execute()
                        except Exception as e:  # stats are nice to have; never block the token check
                            log.warning("page_stats save failed: %s", e)
                    db.table("pages").update({
                        "name": info.get("name") or p["name"],
                        "followers": followers,
                        "picture_url": (info.get("picture") or {}).get("data", {}).get("url"),
                    }).eq("id", p["id"]).execute()
                except facebook.TokenError as e:
                    self.mark_invalid(c, p["name"], e)
                except Exception as e:
                    log.warning("page info failed for %s: %s", p["name"], e)
        self.state["token_check_date"] = today

    # ── Planning ─────────────────────────────────────────────────────────────

    def plan(self) -> None:
        today = self.now.date().isoformat()
        if not self.auto or self.state.get("planned_date") == today:
            return
        pages = db.table("pages").select("*").eq("enabled", True).execute().data
        gap = self.s.get("page_gap_minutes") or [20, 40]
        weights = self.category_weights([p["id"] for p in pages]) if self.learning_on else {}
        self.state["learning"] = {"date": today, "weights": weights}
        plan = plan_day(pages, self.now.date(), self.now, int(self.s.get("max_posts_per_page", 8)), tuple(gap),
                        weights=weights)
        limit = self.daily_post_budget()
        if limit and plan:
            allow, per_post = limit
            kept, cost = [], 0
            for c in plan:
                need = per_post * len(c["posts"])
                if kept and cost + need > allow:
                    continue
                kept.append(c)
                cost += need
            if len(kept) < len(plan):
                self.state["throttled"] = {"date": today, "planned": len(plan), "kept": len(kept)}
                self.alert(f"ลดจำนวนคลิปวันนี้จาก {len(plan)} เหลือ {len(kept)} คลิป "
                           f"เพื่อไม่ให้แบนด์วิดท์ Supabase เกิน {self.s.get('egress_budget_pct') or 70}% ของโควตาฟรีเดือนนี้")
                plan = kept
        n_posts = 0
        for c in plan:
            clip = db.table("clips").insert({
                "plan_date": today, "category": c["category"], "style_id": c["style_id"],
                "produce_after": c["produce_after"].isoformat(), "status": "planned",
            }).execute().data[0]
            db.table("clip_posts").insert([
                {"clip_id": clip["id"], "page_id": p["page_id"], "scheduled_at": p["scheduled_at"].isoformat(),
                 "status": "pending"} for p in c["posts"]
            ]).execute()
            n_posts += len(c["posts"])
        if plan:  # an empty plan must not use up the day: a page switched on later today still gets planned
            self.state["planned_date"] = today
            telegram.send(self.chat, f"🗓 วางแผนวันนี้แล้ว: ผลิต {len(plan)} คลิป โพสต์รวม {n_posts} ครั้ง")

    # ── Production ───────────────────────────────────────────────────────────

    def produce(self) -> None:
        deadline = time.monotonic() + PRODUCE_BUDGET_SEC
        stale = self.now - timedelta(minutes=60)
        rows = (db.table("clips").select("*").in_("status", ["planned", "producing"])
                .lte("produce_after", self.now.isoformat()).lt("attempts", MAX_ATTEMPTS)
                .order("produce_after").limit(30).execute().data)
        for clip in rows:
            if clip["status"] == "producing" and _dt(clip["updated_at"]) > stale:
                continue  # another run is working on it
            if not self.auto and not clip.get("created_by"):
                continue
            if time.monotonic() > deadline:
                break
            self.produce_one(clip)

    def produce_one(self, clip: dict) -> None:
        cid = clip["id"]
        attempts = clip["attempts"] + 1
        db.table("clips").update({"status": "producing", "attempts": attempts}).eq("id", cid).execute()
        posts = (db.table("clip_posts").select("id,page_id,scheduled_at,pages(name,require_approval)")
                 .eq("clip_id", cid).eq("status", "pending").order("scheduled_at").execute().data)
        if not posts:
            db.table("clips").update({"status": "cancelled"}).eq("id", cid).execute()
            return
        work = WORK_DIR / cid
        try:
            work.mkdir(parents=True, exist_ok=True)
            style = dict(DEFAULT_STYLE)
            if clip.get("style_id"):
                rows = db.table("styles").select("config").eq("id", clip["style_id"]).execute().data
                if rows:
                    style.update(rows[0]["config"] or {})
            since = (self.now - timedelta(days=30)).isoformat()
            recent = [r["topic"] for r in db.table("clips").select("topic").eq("category", clip["category"])
                      .gte("created_at", since).not_.is_("topic", "null").limit(60).execute().data]

            topic = clip.get("topic") or self.take_banked_topic(cid, clip["category"])
            ab = self.ab_on and len(posts) >= 2
            script = scriptwriter.write(clip["category"], style, len(posts), self.providers, recent,
                                        topic=topic, feeds=self.s.get("news_feeds") or [],
                                        banned=self.banned, hook_b=ab)
            script["stamp"] = thai_stamp(self.now)
            texts = [seg["say"] for seg in script["segments"]] + [script["cta"]["say"]]
            voice, spans = tts.voice_segments(texts, style.get("voice", "female"), style.get("voice_rate", "+0%"),
                                              self.providers.get("tts", "gemini"), work)
            rng = random.Random(cid)
            keywords = (script.get("bg_keywords") or []) + [style.get("background_hint", "")] \
                + CATEGORIES[clip["category"]]["keywords"]
            bg, kind, credit = media.background(style.get("background", "video"), keywords, work, rng)

            logo = None
            if style.get("show_logo") and style.get("logo_path"):
                logo = work / "logo.png"
                r = httpx.get(db.public_url(style["logo_path"]), timeout=60)
                if r.status_code == 200:
                    logo.write_bytes(r.content)
                else:
                    logo = None

            out = work / "clip.mp4"
            duration = render.render(script, voice, spans, bg, kind, style, logo, work, out)
            if duration > 89:
                raise RuntimeError(f"คลิปยาว {duration:.0f} วินาที เกินที่ Reels รับได้ (90 วินาที)")
            thumb = render.thumbnail(out, work / "thumb.jpg")
            script["bytes"] = out.stat().st_size
            if ab and script.get("hook_b"):
                try:
                    work_b = work / "b"
                    work_b.mkdir(exist_ok=True)
                    out_b = work_b / "clip.mp4"
                    render.render({**script, "hook": script["hook_b"]}, voice, spans, bg, kind, style, logo, work_b, out_b)
                    thumb_b = render.thumbnail(out_b, work_b / "thumb.jpg")
                    # Alternate pages in posting order: A, B, A, B...
                    script["ab"] = {
                        "video_path": db.upload(out_b, f"videos/{cid}-b.mp4", "video/mp4"),
                        "thumb_path": db.upload(thumb_b, f"thumbs/{cid}-b.jpg", "image/jpeg"),
                        "bytes": out_b.stat().st_size,
                        "posts": {p["id"]: ("A" if i % 2 == 0 else "B") for i, p in enumerate(posts)},
                    }
                except Exception as e:  # the test is optional; the clip still goes out with headline A
                    log.warning("variant B failed: %s", e)
            video_path = db.upload(out, f"videos/{cid}.mp4", "video/mp4")
            thumb_path = db.upload(thumb, f"thumbs/{cid}.jpg", "image/jpeg")

            script["credit"] = credit
            db.table("clips").update({
                "status": "ready", "script": script, "topic": script.get("topic") or clip.get("topic"),
                "source_url": script.get("source_url") or clip.get("source_url"),
                "source_title": script.get("source_title") or clip.get("source_title"),
                "video_path": video_path, "thumb_path": thumb_path, "duration_sec": round(duration, 1), "error": None,
            }).eq("id", cid).execute()

            tags = " ".join(script.get("hashtags") or [])
            credit = f"\n\nที่มา: {', '.join(script['sources'])}" if script.get("sources") else ""
            for i, p in enumerate(posts):
                pc = self.page_captions.get(p["page_id"]) or {}
                page_tags = [t if t.startswith("#") else f"#{t}" for t in (pc.get("hashtags") or []) if isinstance(t, str) and t.strip()]
                all_tags = " ".join(dict.fromkeys((script.get("hashtags") or []) + page_tags))
                footer = f"\n\n{pc['footer'].strip()}" if isinstance(pc.get("footer"), str) and pc["footer"].strip() else ""
                caption = f"{script['captions'][i]}{credit}{footer}\n\n{all_tags}".strip()
                needs = (p.get("pages") or {}).get("require_approval") or clip["category"] in self.approval_cats
                db.table("clip_posts").update({
                    "caption": caption, "status": "awaiting_approval" if needs else "scheduled",
                }).eq("id", p["id"]).execute()
            log.info("produced %s (%s) %.0fs", cid, script.get("topic"), duration)
        except Exception as e:
            log.exception("produce %s failed", cid)
            if attempts >= MAX_ATTEMPTS:
                db.table("clips").update({"status": "failed", "error": str(e)[:1000]}).eq("id", cid).execute()
                db.table("clip_posts").update({"status": "failed", "error": "ผลิตคลิปไม่สำเร็จ"}) \
                    .eq("clip_id", cid).eq("status", "pending").execute()
                self.alert(f"ผลิตคลิป {_esc(label(clip['category']))} ไม่สำเร็จหลังลอง {attempts} ครั้ง: {_esc(e)}")
            else:
                db.table("clips").update({
                    "status": "planned", "error": str(e)[:1000],
                    "produce_after": (self.now + timedelta(minutes=10)).isoformat(),
                }).eq("id", cid).execute()
        finally:
            shutil.rmtree(work, ignore_errors=True)

    # ── Telegram ─────────────────────────────────────────────────────────────

    def clip_message(self, clip: dict, posts: list[dict], header: str) -> str:
        lines = [f"<b>{header}</b>", _esc(clip.get("topic")), f"หมวด: {_esc(label(clip['category']))}"]
        marks = {"posted": " ✓", "failed": " ✗", "cancelled": " ยกเลิก", "deleted": " ลบแล้ว",
                 "awaiting_approval": " รออนุมัติ"}
        lines.append(" · ".join(
            f"{_esc((p.get('pages') or {}).get('name'))} {_hm(p['scheduled_at'])}{marks.get(p['status'], '')}"
            for p in sorted(posts, key=lambda p: p["scheduled_at"])))
        if clip.get("source_url"):
            lines.append(f'ที่มา: <a href="{_esc(clip["source_url"])}">{_esc(clip.get("source_title") or "ข่าวต้นทาง")}</a>')
        return "\n".join(lines)

    def notify(self) -> None:
        if not self.chat:
            return
        lead = int(self.s.get("notify_minutes_before", 30))
        horizon = (self.now + timedelta(minutes=lead)).isoformat()
        rows = (db.table("clip_posts").select("clip_id").in_("status", ["scheduled", "awaiting_approval"])
                .lte("scheduled_at", horizon).execute().data)
        for cid in {r["clip_id"] for r in rows}:
            clip = db.table("clips").select("*").eq("id", cid).execute().data[0]
            if clip["status"] != "ready" or clip.get("tg_message_id"):
                continue
            posts = (db.table("clip_posts").select("id,status,scheduled_at,pages(name)")
                     .eq("clip_id", cid).execute().data)
            open_posts = [p for p in posts if p["status"] in ("scheduled", "awaiting_approval")]
            if not open_posts:
                continue
            needs = any(p["status"] == "awaiting_approval" for p in open_posts)
            first = min(_dt(p["scheduled_at"]) for p in open_posts)
            mins = max(0, int((first - self.now).total_seconds() // 60))
            header = "รออนุมัติก่อนโพสต์" if needs else f"จะโพสต์ใน {mins} นาที · {first:%H:%M}"
            text = self.clip_message(clip, posts, header)
            text += "\n" + ("เพจที่ต้องอนุมัติจะไม่โพสต์จนกว่าจะกดอนุมัติ" if needs else "ถ้าไม่กดอะไร ระบบโพสต์ตามเวลาเอง")
            mid = telegram.send_video(self.chat, db.public_url(clip["video_path"]), text,
                                      telegram.buttons(cid, "approval" if needs else "default"))
            db.table("clips").update({"tg_message_id": mid}).eq("id", cid).execute()
            db.table("clip_posts").update({"status": "notified"}).eq("clip_id", cid).eq("status", "scheduled").execute()

    def refresh_message(self, cid: str) -> None:
        clip = db.table("clips").select("*").eq("id", cid).execute().data[0]
        if not self.chat or not clip.get("tg_message_id"):
            return
        posts = db.table("clip_posts").select("id,status,scheduled_at,pages(name)").eq("clip_id", cid).execute().data
        if any(p["status"] in OPEN for p in posts):
            return
        posted = any(p["status"] == "posted" for p in posts)
        header = "โพสต์แล้ว" if posted else "ไม่ได้โพสต์"
        telegram.edit_caption(self.chat, clip["tg_message_id"], self.clip_message(clip, posts, header),
                              telegram.buttons(cid, "posted" if posted else "none"))

    # ── Publishing ───────────────────────────────────────────────────────────

    def publish(self) -> None:
        # A post stuck in 'posting' means a run died mid-upload. Never retry blindly: it may already be live.
        stuck = (self.now - timedelta(minutes=30)).isoformat()
        for p in (db.table("clip_posts").select("id,clip_id").eq("status", "posting")
                  .lt("updated_at", stuck).execute().data):
            db.table("clip_posts").update({"status": "failed", "error": "ไม่แน่ใจว่าโพสต์สำเร็จ ตรวจในเพจก่อนโพสต์ซ้ำ"}) \
                .eq("id", p["id"]).execute()

        # Posts that waited too long for approval are dropped.
        expire = (self.now - timedelta(hours=6)).isoformat()
        db.table("clip_posts").update({"status": "cancelled", "error": "ไม่มีคนอนุมัติ"}) \
            .eq("status", "awaiting_approval").lt("scheduled_at", expire).execute()

        rows = (db.table("clip_posts")
                .select("*, clips(status,video_path,topic,script), pages(name,fb_page_id,enabled)")
                .in_("status", ["scheduled", "notified"]).order("scheduled_at").execute().data)
        # post_now = someone pressed "post now": it goes out even while automation is paused or over the daily cap.
        due = [p for p in rows if _dt(p["scheduled_at"]) <= self.now and (self.auto or p["post_now"])]

        day_start = self.now.replace(hour=0, minute=0, second=0, microsecond=0).isoformat()
        cap = int(self.s.get("max_posts_per_page", 8))
        touched = set()
        for p in due:
            clip, page = p.get("clips") or {}, p.get("pages") or {}
            if clip.get("status") != "ready":
                if self.now - _dt(p["scheduled_at"]) > timedelta(hours=3):
                    db.table("clip_posts").update({"status": "failed", "error": "ผลิตคลิปไม่ทันเวลา"}).eq("id", p["id"]).execute()
                continue
            if not page.get("enabled"):
                db.table("clip_posts").update({"status": "cancelled", "error": "เพจถูกปิดใช้งาน"}).eq("id", p["id"]).execute()
                touched.add(p["clip_id"])
                continue
            count = (db.table("clip_posts").select("id", count="exact").eq("page_id", p["page_id"])
                     .eq("status", "posted").gte("posted_at", day_start).execute().count or 0)
            if count >= cap and not p["post_now"]:
                db.table("clip_posts").update({"status": "cancelled", "error": f"ครบ {cap} โพสต์ของวันนี้แล้ว"}).eq("id", p["id"]).execute()
                touched.add(p["clip_id"])
                continue

            db.table("clip_posts").update({"status": "posting"}).eq("id", p["id"]).execute()
            result, error = None, "ไม่มีกุญแจ Facebook ที่ใช้ได้"
            for conn in self.connections(p["page_id"]):
                try:
                    result = facebook.publish_reel(page["fb_page_id"], decrypt(conn["token_enc"]),
                                                   db.public_url(self.video_for(p, clip)), p.get("caption") or "")
                    break
                except facebook.TokenError as e:
                    self.mark_invalid(conn, page.get("name"), e)
                except Exception as e:
                    error = str(e)
                    break
            if result:
                db.table("clip_posts").update({"status": "posted", "fb_video_id": result, "posted_at": self.now.isoformat(),
                                               "error": None, "post_now": False}).eq("id", p["id"]).execute()
                log.info("posted %s to %s", clip.get("topic"), page.get("name"))
                ab = (clip.get("script") or {}).get("ab") or {}
                size = ab.get("bytes") if self.video_for(p, clip) == ab.get("video_path") else (clip.get("script") or {}).get("bytes")
                self.add_egress(int(size or DEFAULT_POST_BYTES))
            else:
                db.table("clip_posts").update({"status": "failed", "error": error[:1000]}).eq("id", p["id"]).execute()
                self.alert(f"โพสต์ลงเพจ {_esc(page.get('name'))} ไม่สำเร็จ: {_esc(error)}")
            touched.add(p["clip_id"])

        for cid in touched:
            try:
                self.refresh_message(cid)
            except Exception as e:
                log.warning("refresh message failed: %s", e)

    def deletions(self) -> None:
        rows = (db.table("clip_posts").select("id,clip_id,page_id,fb_video_id,pages(name)")
                .eq("status", "delete_requested").execute().data)
        touched = set()
        for p in rows:
            ok, err = False, "ไม่มีกุญแจ Facebook ที่ใช้ได้"
            for conn in self.connections(p["page_id"]):
                try:
                    facebook.delete_video(p["fb_video_id"], decrypt(conn["token_enc"]))
                    ok = True
                    break
                except facebook.TokenError as e:
                    self.mark_invalid(conn, (p.get("pages") or {}).get("name"), e)
                except Exception as e:
                    err = str(e)
                    break
            db.table("clip_posts").update({"status": "deleted"} if ok else {"status": "posted", "error": f"ลบไม่สำเร็จ: {err}"[:1000]}) \
                .eq("id", p["id"]).execute()
            if not ok:
                self.alert(f"ลบโพสต์ในเพจ {_esc((p.get('pages') or {}).get('name'))} ไม่สำเร็จ: {_esc(err)}")
            touched.add(p["clip_id"])
        for cid in touched:
            try:
                self.refresh_message(cid)
            except Exception as e:
                log.warning("refresh message failed: %s", e)

    # ── Learning, topic bank, A/B ────────────────────────────────────────────

    @staticmethod
    def video_for(post: dict, clip: dict) -> str:
        ab = (clip.get("script") or {}).get("ab") or {}
        if ab.get("video_path") and (ab.get("posts") or {}).get(post["id"]) == "B":
            return ab["video_path"]
        return clip["video_path"]

    def category_weights(self, page_ids: list[str]) -> dict[str, dict[str, float]]:
        """Per page: average Reel plays of each category / the page's overall average, from the last 21 days.
        A page needs 10+ measured Reels and a category 3+ before it moves away from an equal share;
        weights stay between 0.4 and 2.5 so weaker categories still get tested."""
        since = (self.now - timedelta(days=21)).isoformat()
        try:
            rows = (db.table("post_stats").select("page_id,plays,clip_posts!inner(posted_at,clips(category))")
                    .gte("clip_posts.posted_at", since).not_.is_("plays", "null").limit(3000).execute().data)
        except Exception as e:
            log.warning("learning skipped: %s", e)
            return {}
        out: dict[str, dict[str, float]] = {}
        for pid in page_ids:
            mine = [r for r in rows if r["page_id"] == pid]
            if len(mine) < 10:
                continue
            avg = sum(r["plays"] for r in mine) / len(mine) or 1
            by_cat: dict[str, list[int]] = {}
            for r in mine:
                cat = ((r.get("clip_posts") or {}).get("clips") or {}).get("category")
                if cat:
                    by_cat.setdefault(cat, []).append(r["plays"])
            w = {c: round(min(2.5, max(0.4, (sum(v) / len(v)) / avg)), 2) for c, v in by_cat.items() if len(v) >= 3}
            if w:
                out[pid] = w
        return out

    def take_banked_topic(self, clip_id: str, category: str) -> str | None:
        """Use the oldest topic the owner saved for this category, then remove it from the bank."""
        bank = db.settings().get("topic_bank") or []
        for i, t in enumerate(bank):
            if isinstance(t, dict) and t.get("category") == category and str(t.get("topic", "")).strip():
                rest = bank[:i] + bank[i + 1:]
                db.set_setting("topic_bank", rest)
                db.table("clips").update({"topic": t["topic"].strip()}).eq("id", clip_id).execute()
                log.info("using banked topic: %s", t["topic"])
                return t["topic"].strip()
        return None

    # ── Performance stats ────────────────────────────────────────────────────

    def stats(self) -> None:
        """Refresh Facebook numbers for Reels posted in the last 14 days: every 3 h for 2 days, then daily."""
        since = (self.now - timedelta(days=14)).isoformat()
        try:
            posts = (db.table("clip_posts").select("id,page_id,fb_video_id,posted_at,post_stats(fetched_at)")
                     .eq("status", "posted").not_.is_("fb_video_id", "null").gte("posted_at", since)
                     .order("posted_at", desc=True).limit(300).execute().data)
        except Exception as e:  # stats tables not created yet (0002_stats.sql); posting must not suffer
            log.warning("stats skipped: %s", str(e)[:200])
            return
        due = []
        for p in posts:
            st = p.get("post_stats")
            st = st[0] if isinstance(st, list) and st else st
            age = self.now - _dt(p["posted_at"])
            every = timedelta(hours=3) if age < timedelta(days=2) else timedelta(hours=24)
            if not st or self.now - _dt(st["fetched_at"]) >= every:
                due.append(p)
        tokens: dict[str, str | None] = {}
        for p in due[:80]:
            if p["page_id"] not in tokens:
                conns = self.connections(p["page_id"])
                tokens[p["page_id"]] = decrypt(conns[0]["token_enc"]) if conns else None
            token = tokens[p["page_id"]]
            if not token:
                continue
            row = {"post_id": p["id"], "page_id": p["page_id"], "fetched_at": self.now.isoformat()}
            try:
                row.update(facebook.reel_stats(p["fb_video_id"], token), error=None)
            except facebook.PermissionMissing as e:
                if self.state.get("stats_perm_alert") != self.now.date().isoformat():
                    self.state["stats_perm_alert"] = self.now.date().isoformat()
                    self.alert("ดึงสถิติคลิปไม่ได้: กุญแจ Facebook ยังไม่มีสิทธิ์ดูสถิติ เข้าเว็บ หน้าเพจ แล้วกดเชื่อมต่อ Facebook ใหม่")
                log.warning("stats permission missing: %s", e)
                return
            except Exception as e:
                row["error"] = str(e)[:500]
            db.table("post_stats").upsert(row).execute()

    # ── Daily summary and cleanup ────────────────────────────────────────────

    def summary(self) -> None:
        today = self.now.date().isoformat()
        if self.state.get("summary_date") == today or self.now.hour < int(self.s.get("summary_hour", 22)):
            return
        day_start = self.now.replace(hour=0, minute=0, second=0, microsecond=0).isoformat()
        rows = (db.table("clip_posts").select("status,pages(name)").gte("scheduled_at", day_start)
                .lte("scheduled_at", self.now.isoformat()).execute().data)
        by_page: dict[str, int] = {}
        for r in rows:
            if r["status"] == "posted":
                name = (r.get("pages") or {}).get("name", "?")
                by_page[name] = by_page.get(name, 0) + 1
        counts = {s: sum(1 for r in rows if r["status"] == s) for s in ("posted", "failed", "cancelled")}
        lines = [f"📊 <b>สรุปวันนี้</b>", f"โพสต์แล้ว {counts['posted']} · ไม่สำเร็จ {counts['failed']} · ยกเลิก {counts['cancelled']}"]
        lines += [f"• {_esc(n)}: {c} โพสต์" for n, c in sorted(by_page.items(), key=lambda kv: -kv[1])]
        telegram.send(self.chat, "\n".join(lines))
        self.state["summary_date"] = today

    def cleanup(self) -> None:
        if self.state.get("cleanup_date") == self.now.date().isoformat():
            return
        old = (self.now - timedelta(days=3)).isoformat()
        rows = (db.table("clips").select("id,video_path,script,clip_posts(status)").not_.is_("video_path", "null")
                .lt("updated_at", old).limit(200).execute().data)
        done = [c for c in rows if not any(p["status"] in OPEN for p in c.get("clip_posts") or [])]
        paths = [c["video_path"] for c in done]
        for c in done:
            ab = (c.get("script") or {}).get("ab") or {}
            paths += [x for x in (ab.get("video_path"), ab.get("thumb_path")) if x]
        db.remove(paths)
        for c in done:
            db.table("clips").update({"video_path": None}).eq("id", c["id"]).execute()
        self.state["cleanup_date"] = self.now.date().isoformat()
