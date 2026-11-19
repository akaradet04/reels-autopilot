"""Voice-over. Each script segment is voiced separately so on-screen text can follow the voice exactly.

Engines: gemini (free, uses the same key as script writing), edge (free, unofficial and unreliable),
azure (official Microsoft Speech, free tier), openai (paid, only when chosen).
A whole clip is voiced by ONE engine so the voice never changes mid-clip: if an engine fails on any
segment, the clip is voiced again from the start with the next free engine.
"""

import asyncio
import base64
import logging
import os
import subprocess
import time
from collections import deque
from functools import lru_cache
from pathlib import Path
from xml.sax.saxutils import escape

import httpx

from worker import db

log = logging.getLogger("worker")

EDGE_VOICES = {"female": "th-TH-PremwadeeNeural", "male": "th-TH-NiwatNeural"}
GEMINI_VOICES = {"female": "Kore", "male": "Charon"}
OPENAI_VOICES = {"female": "nova", "male": "onyx"}
# Free first, paid last. Edge is the last resort: in testing it answered only about half of the lines, which
# almost never adds up to a whole clip. Azure and OpenAI are only tried when their key has been saved.
AUTO_CHAIN = ["gemini", "azure", "openai", "edge"]
NEEDS_KEY = {"azure": "azure_speech_key", "openai": "openai_api_key"}
GAP_SEC = 0.25
MAX_SPEECH_SEC = 80.0  # Reels allow 90s; leave room for the tail and the rounding of the renderer
MAX_SPEEDUP = 1.35

# Measured on real Thai lines: these speak at ~9-10 chars/s. The newer "3.8" TTS models were measured to read lines
# twice (4 chars/s) and to hit the free quota within a few calls, so they are never used automatically.
GEMINI_TTS_MODELS = ["gemini-2.5-flash-preview-tts", "gemini-3.1-flash-tts-preview"]

# How Gemini is told to speak. Adding "จังหวะกระชับ ไม่เนิบช้า" looked about 20-30% faster on one sample, but it was
# not measured properly (the free quota ran out), so it is not switched on yet.
GEMINI_STYLE = "พูดด้วยน้ำเสียงอบอุ่นและเป็นกันเอง"

# Gemini leaves long pauses inside sentences: ~20% of a clip's audio is silence. Long pauses are trimmed instead of
# speeding the speech up, so the pitch and the pace of the words stay natural. silenceremove lets stop_duration of
# silence through and then keeps stop_silence more, so each long pause ends up ~0.25s. Measured on a real 33.2s clip:
# it becomes 28.4s (-14%) while the speech itself stays 26.4s, i.e. only silence is removed.
TIGHTEN_PAUSES = True
PAUSE_FILTER = ("silenceremove=start_periods=1:start_duration=0.05:start_threshold=-40dB:"
                "stop_periods=-1:stop_duration=0.15:stop_threshold=-40dB:stop_silence=0.10")


def probe_duration(path: Path) -> float:
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)],
        capture_output=True, text=True, check=True,
    ).stdout.strip()
    return float(out)


# ─── Gemini ──────────────────────────────────────────────────────────────────

@lru_cache(maxsize=1)
def _gemini_tts_models() -> list[str]:
    """The approved models this key can actually see. Falls back to the approved list when the lookup fails."""
    try:
        r = httpx.get("https://generativelanguage.googleapis.com/v1beta/models", params={"pageSize": 200},
                      headers={"x-goog-api-key": db.secret("gemini_api_key")}, timeout=30)
        r.raise_for_status()
        seen = {m["name"].removeprefix("models/") for m in r.json().get("models", [])}
        return [m for m in GEMINI_TTS_MODELS if m in seen] or list(GEMINI_TTS_MODELS)
    except httpx.HTTPError:
        return list(GEMINI_TTS_MODELS)


def _tempo(rate: str) -> float:
    """'-5%' -> 0.95. Gemini has no speed setting, so the speed change is applied while converting."""
    try:
        return min(2.0, max(0.5, 1 + float(rate.strip().rstrip("%")) / 100))
    except ValueError:
        return 1.0


speed_factor = _tempo  # public name: how much faster than normal a rate like "+10%" is


def _pcm_to_mp3(pcm: bytes, rate: str, out: Path) -> None:
    filters = ([PAUSE_FILTER] if TIGHTEN_PAUSES else []) + [f"atempo={_tempo(rate):.3f}"]
    subprocess.run(
        ["ffmpeg", "-y", "-v", "error", "-f", "s16le", "-ar", "24000", "-ac", "1", "-i", "pipe:0",
         "-af", ",".join(filters), "-c:a", "libmp3lame", "-q:a", "3", str(out)],
        input=pcm, check=True,
    )


def _now() -> float:
    return time.monotonic()


def _pause(seconds: float) -> None:
    time.sleep(seconds)


# The free tier allows 3 requests per minute per model (Google's own 429 says "GenerateRequestsPerMinutePerProjectPerModel-
# FreeTier, limit 3"). Calls are spaced out here instead of failing: a 7-segment clip takes about 2 minutes to voice.
GEMINI_RPM = 3
GEMINI_WINDOW_SEC = 62.0
_gemini_calls: dict[str, deque] = {}


def _wait_for_slot(model: str) -> None:
    q = _gemini_calls.setdefault(model, deque())
    while True:
        now = _now()
        while q and now - q[0] > GEMINI_WINDOW_SEC:
            q.popleft()
        if len(q) < GEMINI_RPM:
            q.append(now)
            return
        _pause(q[0] + GEMINI_WINDOW_SEC - now + 0.1)


def _quota_wait(resp) -> float | None:
    """Seconds to wait when Google refused for a per-minute limit; None for a daily limit, where waiting is pointless."""
    try:
        details = resp.json().get("error", {}).get("details", [])
    except ValueError:
        return 30.0
    delay = None
    for d in details:
        kind = d.get("@type", "")
        if kind.endswith("QuotaFailure") and any("PerDay" in (v.get("quotaId") or "") for v in d.get("violations", [])):
            return None
        if kind.endswith("RetryInfo"):
            try:
                delay = float(str(d.get("retryDelay", "")).rstrip("s"))
            except ValueError:
                pass
    return min(max(delay or 30.0, 1.0) + 1.0, 65.0)


def _gemini_tts(text: str, gender: str, rate: str, out: Path) -> None:
    key = db.secret("gemini_api_key")
    if not key:
        raise RuntimeError("ยังไม่ได้ใส่ Gemini API key")
    body = {
        "contents": [{"parts": [{"text": f"{GEMINI_STYLE}: {text}"}]}],
        "generationConfig": {
            "responseModalities": ["AUDIO"],
            "speechConfig": {"voiceConfig": {"prebuiltVoiceConfig": {"voiceName": GEMINI_VOICES[gender]}}},
        },
    }
    errors = []
    for model in _gemini_tts_models():
        for attempt in range(4):
            _wait_for_slot(model)
            r = httpx.post(f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
                           headers={"x-goog-api-key": key}, json=body, timeout=120)
            if r.status_code == 200:
                parts = r.json().get("candidates", [{}])[0].get("content", {}).get("parts", [{}])
                data = (parts[0].get("inlineData") or {}).get("data")
                if data:
                    _pcm_to_mp3(base64.b64decode(data), rate, out)
                    return
                errors.append(f"{model}: ไม่มีเสียงกลับมา")
                break
            errors.append(f"{model}: {r.status_code}")
            if r.status_code == 429:
                wait = _quota_wait(r)
                if wait is None:  # daily limit: waiting does not help, try the next model
                    break
                _pause(wait)
                continue
            if r.status_code in (500, 503) and attempt == 0:
                _pause(5)
                continue
            break
    raise RuntimeError("Gemini เสียงใช้ไม่ได้ (" + ", ".join(errors) + ")")


# ─── Edge TTS ────────────────────────────────────────────────────────────────

async def _edge_once(text: str, voice: str, rate: str, out: Path) -> None:
    import edge_tts
    await edge_tts.Communicate(text, voice, rate=rate).save(str(out))


def _edge(text: str, gender: str, rate: str, out: Path, attempts: int = 3) -> None:
    for i in range(attempts):
        try:
            asyncio.run(_edge_once(text, EDGE_VOICES[gender], rate, out))
            if out.exists() and out.stat().st_size > 0:
                return
        except Exception as e:
            log.warning("edge-tts attempt %d failed: %s", i + 1, type(e).__name__)
        time.sleep(3 * (i + 1))
    raise RuntimeError("Edge TTS ไม่ตอบกลับ")


# ─── Azure and OpenAI ────────────────────────────────────────────────────────

def _azure(text: str, gender: str, rate: str, out: Path) -> None:
    key, region = db.secret("azure_speech_key"), db.secret("azure_speech_region") or "southeastasia"
    if not key:
        raise RuntimeError("ยังไม่ได้ใส่ Azure Speech key")
    ssml = (f'<speak version="1.0" xml:lang="th-TH"><voice name="{EDGE_VOICES[gender]}">'
            f'<prosody rate="{escape(rate or "+0%")}">{escape(text)}</prosody></voice></speak>')
    r = httpx.post(
        f"https://{region}.tts.speech.microsoft.com/cognitiveservices/v1",
        headers={"Ocp-Apim-Subscription-Key": key, "Content-Type": "application/ssml+xml",
                 "X-Microsoft-OutputFormat": "audio-24khz-96kbitrate-mono-mp3", "User-Agent": "reels-autopilot"},
        content=ssml.encode("utf-8"), timeout=60,
    )
    r.raise_for_status()
    out.write_bytes(r.content)


def _openai(text: str, gender: str, rate: str, out: Path) -> None:
    r = httpx.post(
        "https://api.openai.com/v1/audio/speech",
        headers={"Authorization": f"Bearer {db.secret('openai_api_key')}"},
        json={"model": "tts-1", "voice": OPENAI_VOICES[gender], "input": text, "response_format": "mp3"},
        timeout=120,
    )
    r.raise_for_status()
    out.write_bytes(r.content)


def _silence(text: str, gender: str, rate: str, out: Path) -> None:
    """Offline sample only: silent audio sized like real speech."""
    dur = max(1.0, len(text) / 11)
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-f", "lavfi", "-i", "anullsrc=r=24000:cl=mono",
                    "-t", f"{dur:.2f}", "-c:a", "libmp3lame", str(out)], check=True)


ENGINES = {"gemini": _gemini_tts, "edge": _edge, "azure": _azure, "openai": _openai, "silent": _silence}


# ─── Public ──────────────────────────────────────────────────────────────────

def _voice_all(texts: list[str], gender: str, rate: str, engine: str, work: Path) -> list[Path]:
    parts = []
    for i, text in enumerate(texts):
        out = work / f"seg{i}.mp3"
        ENGINES[engine](text, gender, rate, out)
        if not out.exists() or out.stat().st_size == 0:
            raise RuntimeError("ไม่มีไฟล์เสียง")
        parts.append(out)
    return parts


def voice_segments(texts: list[str], gender: str, rate: str, provider: str, work: Path) -> tuple[Path, list[tuple[float, float]]]:
    """Returns the combined audio file and (start, end) seconds for each text."""
    gender = gender if gender in EDGE_VOICES else "female"
    rate = rate or "+0%"
    order = ["silent"] if os.getenv("SAMPLE_SILENT") == "1" else [provider] + [p for p in AUTO_CHAIN if p != provider]
    errors, parts = [], None
    for name in order:
        if name not in ENGINES:
            continue
        if name in NEEDS_KEY and not db.secret(NEEDS_KEY[name]):
            if name == provider:
                errors.append(f"{name}: ยังไม่ได้ใส่คีย์")
            continue
        try:
            parts = _voice_all(texts, gender, rate, name, work)
            log.info("voiced %d segments with %s", len(texts), name)
            break
        except (RuntimeError, httpx.HTTPError, subprocess.CalledProcessError) as e:
            errors.append(f"{name}: {e}")
            log.warning("voice engine %s failed, trying the next: %s", name, e)
    if parts is None:
        raise RuntimeError("สร้างเสียงพากย์ไม่สำเร็จ " + "; ".join(errors))

    spans, t = [], 0.0
    for p in parts:
        d = probe_duration(p)
        spans.append((t, t + d))
        t += d + GAP_SEC

    # A script that runs long is sped up instead of being rejected after rendering.
    total = spans[-1][1]
    tempo = min(MAX_SPEEDUP, total / MAX_SPEECH_SEC) if total > MAX_SPEECH_SEC else 1.0
    if tempo > 1.0:
        spans = [(a / tempo, b / tempo) for a, b in spans]
        log.info("speech %.0fs is long, speeding up x%.2f", total, tempo)

    inputs, filters = [], []
    for i, p in enumerate(parts):
        inputs += ["-i", str(p)]
        filters.append(f"[{i}:a]aresample=48000,apad=pad_dur={GAP_SEC}[a{i}]")
    joined = "".join(f"[a{i}]" for i in range(len(parts))) + f"concat=n={len(parts)}:v=0:a=1"
    filters.append(f"{joined}[cat];[cat]atempo={tempo:.3f}[out]" if tempo > 1.0 else f"{joined}[out]")
    voice = work / "voice.m4a"
    subprocess.run(
        ["ffmpeg", "-y", "-v", "error", *inputs, "-filter_complex", ";".join(filters),
         "-map", "[out]", "-c:a", "aac", "-b:a", "160k", str(voice)],
        check=True,
    )
    return voice, spans
