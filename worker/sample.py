"""Offline sample render with a fixed script, to check text layout, Thai shaping and voice timing."""

import os
import shutil
from pathlib import Path

from worker import render, tts
from worker.config import WORK_DIR

SCRIPT = {
    "hook": "ก่อนนอนคืนนี้ ทำสิ่งนี้",
    "keyword": "สวดบทนี้ 7 คืน",
    "segments": [
        {"say": "ก่อนนอนคืนนี้ ลองทำสิ่งนี้ดูนะ", "show": "ก่อนนอนคืนนี้"},
        {"say": "นั่งสงบ หายใจเข้าออกช้าๆ สามครั้ง ปล่อยเรื่องที่ค้างใจทั้งวันออกไป", "show": "หายใจช้าๆ 3 ครั้ง|ปล่อยเรื่องค้างใจ"},
        {"say": "จากนั้นสวดอิติปิโสหนึ่งจบ ตั้งใจนึกถึงสิ่งดีที่ได้ทำวันนี้", "show": "สวดอิติปิโส 1 จบ|นึกถึงสิ่งดีวันนี้"},
        {"say": "สุดท้าย แผ่เมตตาให้ตัวเองและคนที่เรารัก ใจจะเบาและหลับง่ายขึ้น", "show": "แผ่เมตตาให้ตัวเอง|และคนที่เรารัก"},
    ],
    "cta": {"say": "บันทึกไว้ แล้วลองทำเจ็ดคืนติดกันนะ", "show": "บันทึกไว้ ทำ 7 คืน"},
}

STYLE = {"hook_color": "#FF2A2A", "keyword_color": "#FF9500", "body_color": "#FFFFFF", "cta_color": "#FFE066",
         "voice": "female", "voice_rate": "+0%", "dim": 0.12}


def render_sample(out: Path, bg: Path, kind: str) -> None:
    work = WORK_DIR / "sample"
    shutil.rmtree(work, ignore_errors=True)
    work.mkdir(parents=True, exist_ok=True)
    local_bg = work / f"bg{bg.suffix}"
    shutil.copy(bg, local_bg)
    texts = [s["say"] for s in SCRIPT["segments"]] + [SCRIPT["cta"]["say"]]
    voice, spans = tts.voice_segments(texts, STYLE["voice"], STYLE["voice_rate"], os.getenv("SAMPLE_TTS", "gemini"), work)
    duration = render.render(SCRIPT, voice, spans, local_bg, kind, STYLE, None, work, work / "clip.mp4")
    out.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy(work / "clip.mp4", out)
    print(f"rendered {out} ({duration:.1f}s)")
