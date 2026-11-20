"""Topic selection and script writing."""

import json

from worker import llm, news
from worker.categories import CATEGORIES
from worker.tts import speed_factor

def chars_per_sec(providers: dict, style: dict) -> float:
    """Spoken Thai per second for the chosen voice and the style's speed. Measured: Gemini speaks ~9 chars/s at +0%
    (about 10 with the long pauses trimmed); the script is sized slightly low so a clip never runs over."""
    base = {"gemini": 9.0}.get(providers.get("tts", "gemini"), 11.0)
    return base * speed_factor(style.get("voice_rate") or "+0%")

# Royal-institution news is legally sensitive in Thailand; never hand it to the model as a candidate.
SKIP_WORDS = ("พระราช", "โปรดเกล้า", "เสด็จ", "ในหลวง", "พระบรม", "สมเด็จพระ", "ทรงพระ", "พระองค์", "ราชวงศ์")


def _allowed(item: dict) -> bool:
    text = f"{item.get('title', '')} {item.get('summary', '')}"
    return not any(w in text for w in SKIP_WORDS)

FORMAT = """
ตอบเป็น JSON อย่างเดียว ตามโครงสร้างนี้:
{{
  "topic": "หัวข้อของคลิปนี้ 1 บรรทัด",
  "hook": "หัวเรื่องตัวใหญ่บนจอ ไม่เกิน 18 ตัวอักษร ดึงดูดให้หยุดดู",{hook_b_field}
  "keyword": "คำสำคัญบนจอ ไม่เกิน 18 ตัวอักษร",
  "segments": [
    {{"say": "ประโยคที่พากย์", "show": "ข้อความบนจอ สั้นกว่าที่พากย์ แบ่งบรรทัดด้วย | บรรทัดละไม่เกิน 18 ตัวอักษร ไม่เกิน 2 บรรทัด"}}
  ],
  "cta": {{"say": "ประโยคปิดชวนแชร์หรือบันทึก", "show": "ข้อความปิดบนจอ ไม่เกิน 18 ตัวอักษร"}},
  "captions": [{captions_hint}],
  "hashtags": ["#แท็ก", "... 3-5 แท็ก"],
  "bg_keywords": ["คำค้นภาษาอังกฤษสำหรับหาวิดีโอพื้นหลัง 2-3 คำ", "..."]{news_field}
}}
กติกา:
- segments มี 4-6 ท่อน ท่อนแรกคือ hook ที่พากย์ให้คนหยุดดูภายใน 3 วินาที
- บทพากย์รวมทุกท่อนไม่เกิน {chars} ตัวอักษร (คลิปยาวราว {duration} วินาที) นับตัวอักษรจริง อย่าเขียนเกิน
- ใช้ภาษาไทยที่คนทั่วไปพูดจริง ไม่ใช้อีโมจิในบทพากย์
- captions ต้องมี {n_captions} อัน เขียนไม่ซ้ำกันเลย อันละ 1-3 ประโยค จบด้วยคำถามชวนคอมเมนต์
"""


def _search_terms(topic: str, providers: dict) -> list[str]:
    """A typed topic is one long Thai string with no spaces. Ask the model for short searchable names and events."""
    try:
        data = llm.generate_json(
            "จากหัวข้อข่าวนี้ สร้างคำค้นข่าวภาษาไทยสั้นๆ 3 ชุด (ชื่อบุคคลหรือเหตุการณ์สำคัญ เว้นวรรคระหว่างคำ ชุดละไม่เกิน 4 คำ "
            'ชุดแรกเป็นชื่อบุคคลหลักอย่างเดียว) ตอบ JSON: {"queries": ["...", "...", "..."]}\n'
            f"หัวข้อ: {topic}", providers)
        queries = [q.strip() for q in data.get("queries", []) if isinstance(q, str) and q.strip()]
    except Exception:
        queries = []
    return queries[:3] or [topic]


GROUNDED_RULES = (
    "เขียนจากหัวข้อข่าวเหล่านี้เท่านั้น ห้ามเติมข้อเท็จจริง รายละเอียด หรือคำพูดที่ไม่มีในรายการ "
    "ห้ามใส่อาชีพ ฉายา หรือคำบรรยายบุคคลที่ไม่ปรากฏในหัวข้อข่าว เรียกด้วยชื่ออย่างเดียว ห้ามเดาว่าใครรู้จักกันหรือเป็นอะไรกัน "
    "ห้ามอ้างคำพูดที่ไม่มีในรายการ ใช้สถานที่ตามข่าว ไม่ใช้คำจากหัวข้อที่ผู้ใช้พิมพ์ถ้าไม่ตรงกับข่าว "
    "รายการเรียงจากใหม่ไปเก่า ข้อมูลของชิ้นที่ใหม่กว่าแทนที่ข้อมูลเก่า ถ้าชิ้นเก่าขัดกับชิ้นใหม่ (เช่น เก่าบอกเตรียมแจ้งความ "
    "แต่ใหม่บอกไม่แจ้งความ) ห้ามใช้ข้อมูลของชิ้นเก่าในเรื่องที่ขัดกันเลย "
    "เลือกเฉพาะรายการที่เกี่ยวกับหัวข้อ ถ้าไม่มีรายการไหนเกี่ยวกับหัวข้อเลย ให้ตอบ {\"no_match\": true} อย่างเดียว "
    "ข่าวที่มีชื่อบุคคลและข้อกล่าวหา: ใช้ชื่อตามที่สื่อรายงาน เขียนเป็นกลาง ทุกข้อกล่าวอ้างต้องระบุว่าใครอ้าง เช่น "
    "“อ้างว่า” “ตามรายงานของ…” “อีกฝ่ายระบุว่า…” อย่าตัดสินว่าใครถูกหรือผิด อย่าใช้คำตัดสินหรือคำด่า "
    "บอกสถานะล่าสุดตามที่รายงาน (เช่น ยังไม่มีข้อสรุป อยู่ระหว่างดำเนินการ) พิมพ์ชื่อสำนักข่าวที่ใช้ใน sources"
)


def _script_text(data: dict) -> str:
    cta = data["cta"]
    lines = [f"หัวเรื่อง: {data.get('hook', '')}", f"คำสำคัญ: {data.get('keyword', '')}"]
    lines += [f"พากย์ {i + 1}: {s['say']} | บนจอ: {s.get('show', '')}" for i, s in enumerate(data["segments"])]
    lines.append(f"ปิด: {cta.get('say', '') if isinstance(cta, dict) else cta}")
    lines += [f"คำบรรยาย {i + 1}: {c}" for i, c in enumerate(data["captions"])]
    return "\n".join(lines)


def _listing(candidates: list[dict]) -> str:
    return "\n".join(
        f"[{i}] {c['title']} ({c.get('source') or 'ไม่ระบุ'}"
        f"{', ' + c['published'].astimezone().strftime('%d/%m %H:%M') if c.get('published') else ''})"
        for i, c in enumerate(candidates)
    )


def _fact_check(data: dict, candidates: list[dict], providers: dict) -> list[str]:
    """A second pass as an editor: every claim in the script must come from the real headlines. Returns the problems."""
    result = llm.generate_json(
        "คุณเป็นบรรณาธิการตรวจข้อเท็จจริง ด้านล่างคือหัวข้อข่าวจริง (แหล่งข้อมูลเดียวที่ใช้ได้) และบทคลิป\n"
        "ตรวจทุกประโยคในบท ทั้งบทพากย์ ข้อความบนจอ และคำบรรยาย ว่าข้อเท็จจริงทุกข้อ (ชื่อ อาชีพหรือคำบรรยายบุคคล สถานที่ เวลา "
        "การกระทำ คำพูด สถานะทางกฎหมาย) ปรากฏหรือสรุปได้โดยตรงจากหัวข้อข่าวหรือไม่\n"
        "รายงานส่วนที่ (ก) มีรายละเอียดที่ไม่มีในหัวข้อข่าว เช่น อาชีพ ฉายา คำบรรยายบุคคล (ข) ขัดแย้งกับหัวข้อข่าว หรือใช้ข้อมูลของชิ้นเก่า "
        "ที่ถูกแทนที่ด้วยชิ้นใหม่กว่าแล้ว (ค) ตัดสินว่าใครถูกหรือผิด หรือเรียกใครด้วยคำตัดสินหรือคำด่า\n"
        "ประโยคเปิดทั่วไป ประโยคชวนคอมเมนต์ ชวนติดตาม และสำนวนเร้าใจที่ไม่ได้อ้างข้อเท็จจริงใหม่ ไม่ถือเป็นปัญหา ไม่ต้องรายงาน\n"
        'ตอบ JSON: {"problems": [{"text": "ส่วนที่มีปัญหา", "why": "เหตุผลสั้นๆ"}]} ถ้าไม่มีปัญหาเลยให้ {"problems": []}\n\n'
        f"หัวข้อข่าว:\n{_listing(candidates)}\n\nบทคลิป:\n{_script_text(data)}",
        providers, temperature=0.1,
    )
    return [f"{p.get('text', '')} — {p.get('why', '')}" for p in result.get("problems", []) if isinstance(p, dict)]


def _recent_block(recent: list[str]) -> str:
    if not recent:
        return ""
    return "หัวข้อที่เคยทำไปแล้ว ห้ามซ้ำหรือคล้าย:\n- " + "\n- ".join(recent[:40]) + "\n"


def _banned_hit(data: dict, banned: list[str]) -> list[str]:
    text = json.dumps({k: data.get(k) for k in ("topic", "hook", "hook_b", "keyword", "segments", "cta", "captions")},
                      ensure_ascii=False).lower()
    return [w for w in banned if w and w.lower() in text]


def write(category: str, style: dict, n_captions: int, providers: dict, recent: list[str],
          topic: str | None = None, feeds: list[str] | None = None,
          banned: list[str] | None = None, hook_b: bool = False) -> dict:
    banned = [w.strip() for w in (banned or []) if isinstance(w, str) and w.strip()]
    cat = CATEGORIES[category]
    duration = int(style.get("duration", 45))
    candidates = []
    news_field = ""
    if category == "news" and not topic:
        candidates = [c for c in news.trends() + news.headlines(feeds or []) if _allowed(c) and not _banned_item(c, banned)]
        if not candidates:
            raise RuntimeError("ดึงข่าวไม่ได้ ทั้ง Google Trends และ RSS")
        news_field = ',\n  "source_index": 0'
    elif category == "news" and topic:
        # A typed news topic is searched in real sources first. The model never writes news from memory.
        candidates = [c for c in news.search(_search_terms(topic, providers), feeds or []) if _allowed(c) and not _banned_item(c, banned)]
        candidates.sort(key=lambda c: c["published"].timestamp() if c.get("published") else 0, reverse=True)  # newest first
        if not candidates:
            raise RuntimeError(f"ไม่พบข่าวล่าสุดเรื่อง “{topic}” ในแหล่งข่าว ระบบจึงไม่เขียนบทเอง เพื่อกันแต่งเรื่อง")
        news_field = ',\n  "source_index": 0,\n  "sources": ["ชื่อสำนักข่าวที่ใช้เป็นแหล่งข้อมูล 2-4 แห่ง"]'

    fmt = FORMAT.format(
        captions_hint=", ".join(f'"คำบรรยายเพจที่ {i + 1}"' for i in range(n_captions)),
        n_captions=n_captions, chars=int(duration * chars_per_sec(providers, style)), duration=duration, news_field=news_field,
        hook_b_field=('\n  "hook_b": "หัวเรื่องแบบที่ 2 สำหรับทดสอบ เล่ามุมต่างจาก hook ไม่เกิน 18 ตัวอักษร",' if hook_b else ""),
    )
    parts = [
        "คุณเป็นคนเขียนบทคลิป Facebook Reels ภาษาไทย สำหรับคนไทยอายุ 23-60 ปี",
        f"หมวด: {cat['label']}",
        f"แนวทาง: {cat['guide']}",
        _recent_block(recent),
        ("ห้ามพูดถึงหรือใช้คำเหล่านี้เด็ดขาด: " + ", ".join(banned)) if banned else "",
    ]
    grounded = bool(topic and candidates)
    if grounded:
        parts.append(f"หัวข้อที่ต้องทำ: {topic}\nนี่คือข่าวล่าสุดจากแหล่งข่าวจริง ใส่เลขข่าวหลักใน source_index. {GROUNDED_RULES}\n{_listing(candidates)}")
    elif topic:
        parts.append(f"หัวข้อที่ต้องทำ: {topic}")
    elif candidates:
        listing = "\n".join(
            f"[{i}] {c['title']} — {c.get('summary', '')} {('(' + c['traffic'] + ')') if c.get('traffic') else ''}"
            for i, c in enumerate(candidates[:40])
        )
        parts.append(
            "ข่าววันนี้จากแหล่งจริง เลือกมา 1 ข่าวที่คนไทยสนใจที่สุดและไม่ซ้ำกับที่เคยทำ "
            "ใส่เลขข่าวใน source_index และเขียนบทจากข้อมูลที่ให้มาเท่านั้น ถ้าข้อมูลไม่พอ ให้พูดเท่าที่รู้และชวนติดตามต่อ:\n"
            + listing
        )
    else:
        parts.append("เลือกหัวข้อเองที่คนกำลังสนใจ และมีประโยชน์จริง")
    parts.append(fmt)

    base_prompt = "\n".join(p for p in parts if p)
    feedback, problems = "", []
    for _ in range(3 if grounded else 1):
        data = llm.generate_json(base_prompt + feedback, providers, temperature=0.4 if grounded else 0.9)
        if data.get("no_match"):
            raise RuntimeError(f"พบข่าวแต่ไม่ตรงกับหัวข้อ “{topic}” ระบบจึงไม่เขียนบทเอง")
        _validate(data, n_captions)
        if not grounded:
            break
        problems = _fact_check(data, candidates, providers)
        if not problems:
            break
        feedback = ("\n\nรอบก่อนบรรณาธิการตรวจพบปัญหาต่อไปนี้ เขียนใหม่ ตัดทุกอย่างที่ไม่มีในหัวข้อข่าวออก:\n- "
                    + "\n- ".join(problems))
    else:
        raise RuntimeError("บทที่ AI เขียนมีข้อมูลที่ไม่มีในข่าวต้นทาง ตรวจแล้วแก้ไม่ผ่าน 3 รอบ ระบบจึงไม่ใช้บทนี้: "
                           + "; ".join(problems[:3]))

    if candidates:
        idx = data.get("source_index")
        src = candidates[idx] if isinstance(idx, int) and 0 <= idx < len(candidates) else candidates[0]
        data["source_title"] = src["title"]
        data["source_url"] = src.get("url") or ""
        if topic:  # outlets are credited in the caption, and only outlets that really appear in the results
            real = {c["source"] for c in candidates if c.get("source")}
            outlets = [s for s in (data.get("sources") or []) if isinstance(s, str) and s in real]
            data["sources"] = outlets or list(dict.fromkeys(c["source"] for c in candidates if c.get("source")))[:3]
    hits = _banned_hit(data, banned)
    if hits:
        raise RuntimeError(f"บทมีคำต้องห้าม ({', '.join(hits[:3])}) ระบบจะเขียนใหม่รอบหน้า")
    if hook_b and not (isinstance(data.get("hook_b"), str) and data["hook_b"].strip() and data["hook_b"] != data["hook"]):
        data.pop("hook_b", None)
    data["hashtags"] = list(dict.fromkeys((data.get("hashtags") or []) + cat["hashtags"]))[:6]
    return data


def _banned_item(item: dict, banned: list[str]) -> bool:
    text = f"{item.get('title', '')} {item.get('summary', '')}".lower()
    return any(w.lower() in text for w in banned)


def _validate(data: dict, n_captions: int) -> None:
    for key in ("hook", "segments", "cta"):
        if not data.get(key):
            raise ValueError(f"Script is missing '{key}': {json.dumps(data, ensure_ascii=False)[:300]}")
    data["segments"] = [s for s in data["segments"] if s.get("say")]
    caps = [c for c in (data.get("captions") or []) if isinstance(c, str) and c.strip()]
    while len(caps) < n_captions:
        caps.append(caps[-1] if caps else data["hook"])
    data["captions"] = caps[:n_captions]
