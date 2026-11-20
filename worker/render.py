"""Render a 1080x1920 Reel: background footage, timed floating text (libass handles Thai shaping), voice, logo."""

import shutil
import subprocess
from pathlib import Path

import httpx

from worker.config import FONTS_DIR
from worker.thai import wrap

FONT_FILE = "Kanit-Bold.ttf"
FONT_NAME = "Kanit"
FONT_URL = "https://github.com/google/fonts/raw/main/ofl/kanit/Kanit-Bold.ttf"
W, H, FPS = 1080, 1920, 30
TAIL_SEC = 0.8


def ensure_font() -> Path:
    path = FONTS_DIR / FONT_FILE
    if not path.exists():
        FONTS_DIR.mkdir(parents=True, exist_ok=True)
        r = httpx.get(FONT_URL, timeout=60, follow_redirects=True)
        r.raise_for_status()
        path.write_bytes(r.content)
    return path


def _ass_color(hex_color: str) -> str:
    h = (hex_color or "#FFFFFF").lstrip("#")
    if len(h) != 6:
        h = "FFFFFF"
    return f"&H00{h[4:6]}{h[2:4]}{h[0:2]}".upper()


def _ts(sec: float) -> str:
    sec = max(sec, 0)
    h, rem = divmod(sec, 3600)
    m, s = divmod(rem, 60)
    return f"{int(h)}:{int(m):02d}:{s:05.2f}"


def _escape(text: str) -> str:
    return text.replace("\\", "").replace("{", "(").replace("}", ")")


def _lines(text: str, width: int, max_lines: int) -> str:
    return r"\N".join(_escape(l) for l in wrap(text, width, max_lines))


def build_ass(script: dict, spans: list[tuple[float, float]], total: float, style: dict) -> str:
    hook_c = _ass_color(style.get("hook_color", "#FF2A2A"))
    kw_c = _ass_color(style.get("keyword_color", "#FF9500"))
    body_c = _ass_color(style.get("body_color", "#FFFFFF"))
    cta_c = _ass_color(style.get("cta_color", "#FFE066"))
    head = f"""[Script Info]
ScriptType: v4.00+
PlayResX: {W}
PlayResY: {H}
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Hook,{FONT_NAME},150,{hook_c},&H000000FF,&H00000000,&H96000000,-1,0,0,0,100,100,0,0,1,10,5,8,50,50,250,222
Style: Keyword,{FONT_NAME},122,{kw_c},&H000000FF,&H00000000,&H96000000,-1,0,0,0,100,100,0,0,1,9,4,8,50,50,690,222
Style: Body,{FONT_NAME},110,{body_c},&H000000FF,&H00000000,&H96000000,-1,0,0,0,100,100,0,0,1,9,4,5,60,60,0,222
Style: Cta,{FONT_NAME},98,{cta_c},&H000000FF,&H00000000,&H96000000,-1,0,0,0,100,100,0,0,1,8,4,2,60,60,330,222
Style: Tag,{FONT_NAME},54,&H00FFFFFF,&H000000FF,{_ass_color(style.get("badge_color", "#E5252A"))},&H00000000,-1,0,0,0,100,100,3,0,3,18,0,7,70,70,105,222
Style: Stamp,{FONT_NAME},46,&H00FFFFFF,&H000000FF,&H00000000,&H96000000,-1,0,0,0,100,100,0,0,1,5,2,9,60,60,118,222
Style: Source,{FONT_NAME},42,&H00E8E8E8,&H000000FF,&H00000000,&H96000000,-1,0,0,0,100,100,0,0,1,5,2,2,60,60,105,222

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
    pop = r"{\fad(120,80)\fscx85\fscy85\t(0,160,\fscx100\fscy100)}"
    ev = []
    end_all = total
    # News look, all optional per style: a small badge with the time, the outlets credited on screen, a thin progress bar.
    if style.get("badge"):
        ev.append(f"Dialogue: 2,{_ts(0)},{_ts(end_all)},Tag,,0,0,0,,{{\\fad(150,0)}}{_escape(style['badge'])}")
        if script.get("stamp"):
            ev.append(f"Dialogue: 2,{_ts(0)},{_ts(end_all)},Stamp,,0,0,0,,{{\\fad(150,0)}}{_escape(script['stamp'])}")
    if style.get("show_sources") and script.get("sources"):
        credit = _lines("ที่มา: " + ", ".join(script["sources"]), 34, 2)
        ev.append(f"Dialogue: 2,{_ts(0.8)},{_ts(end_all)},Source,,0,0,0,,{{\\fad(300,0)}}{credit}")
    if style.get("progress_bar"):
        bar = _ass_color(style.get("bar_color", "#FFFFFF"))
        ms = int(end_all * 1000)
        ev.append(f"Dialogue: 3,{_ts(0)},{_ts(end_all)},Body,,0,0,0,,"
                  f"{{\\an7\\pos(0,{H - 14})\\fscx0\\t(0,{ms},\\fscx100)\\bord0\\shad0\\1c{bar}&\\p1}}"
                  f"m 0 0 l {W} 0 {W} 14 0 14{{\\p0}}")
    ev.append(f"Dialogue: 0,{_ts(0)},{_ts(end_all)},Hook,,0,0,0,,{pop}{_lines(script['hook'], 16, 2)}")
    if script.get("keyword"):
        k_start = spans[0][1] if spans else 0
        ev.append(f"Dialogue: 0,{_ts(k_start)},{_ts(end_all)},Keyword,,0,0,0,,{pop}{_lines(script['keyword'], 18, 2)}")
    segments = script["segments"]
    # spans: one per segment, then the CTA. The first segment is the spoken hook, already on screen.
    for i, seg in enumerate(segments[1:], start=1):
        start, end = spans[i]
        nxt = spans[i + 1][0] if i + 1 < len(spans) else end
        text = _lines(seg.get("show") or seg["say"], 18, 3)
        ev.append(f"Dialogue: 0,{_ts(start)},{_ts(nxt)},Body,,0,0,0,,{{\\pos({W // 2},{int(H * 0.62)})}}{pop}{text}")
    cta = script.get("cta") or {}
    if cta and len(spans) > len(segments):
        start = spans[len(segments)][0]
        ev.append(f"Dialogue: 0,{_ts(start)},{_ts(end_all)},Cta,,0,0,0,,{pop}{_lines(cta.get('show') or cta.get('say', ''), 18, 2)}")
    return head + "\n".join(ev) + "\n"


def render(script: dict, voice: Path, spans: list[tuple[float, float]], bg: Path, bg_kind: str,
           style: dict, logo: Path | None, work: Path, out: Path) -> float:
    font = ensure_font()
    fonts = work / "fonts"
    fonts.mkdir(exist_ok=True)
    shutil.copy(font, fonts / FONT_FILE)

    total = spans[-1][1] + TAIL_SEC
    (work / "subs.ass").write_text(build_ass(script, spans, total, style), encoding="utf-8")

    dim = float(style.get("dim", 0.3))
    if bg_kind == "video":
        bg_in = ["-stream_loop", "-1", "-i", bg.name]
        base = f"[0:v]scale={W}:{H}:force_original_aspect_ratio=increase,crop={W}:{H},setsar=1,fps={FPS}"
    else:
        bg_in = ["-loop", "1", "-framerate", str(FPS), "-i", bg.name]
        # Slow vertical drift so a still photo does not look frozen.
        base = (f"[0:v]scale={int(W * 1.12)}:{int(H * 1.12)}:force_original_aspect_ratio=increase,"
                f"crop={W}:{H}:x='(iw-{W})/2':y='(ih-{H})*t/{total:.2f}',setsar=1,fps={FPS}")
    chain = [f"{base},drawbox=x=0:y=0:w=iw:h=ih:color=black@{dim:.2f}:t=fill[bg]"]

    inputs = [*bg_in, "-i", voice.name]
    last, n_in = "[bg]", 2
    if style.get("vignette"):
        # Dark only where the text sits (top and bottom); the middle of the picture stays bright.
        vig = work / "vignette.png"
        subprocess.run(
            ["ffmpeg", "-y", "-v", "error", "-f", "lavfi", "-i", f"color=c=black:s={W}x{H}:d=0.04", "-vf",
             f"format=rgba,geq=r='0':g='0':b='0':a='255*min(1,0.8*pow(abs(2*Y/H-1),2.2)+{float(style.get('vignette_floor', 0.1)):.2f})'",
             "-frames:v", "1", str(vig)], check=True)
        inputs += ["-loop", "1", "-framerate", str(FPS), "-i", vig.name]
        chain.append(f"{last}[{n_in}:v]overlay=0:0:shortest=1[vgn]")
        last, n_in = "[vgn]", n_in + 1
    if logo and logo.exists():
        inputs += ["-i", logo.name]
        chain.append(f"[{n_in}:v]scale=170:-1[lg]")
        chain.append(f"{last}[lg]overlay=W-w-48:72[withlogo]")
        last = "[withlogo]"
    chain.append(f"{last}ass=subs.ass:fontsdir=fonts[v]")
    chain.append("[1:a]apad[a]")

    cmd = [
        "ffmpeg", "-y", "-v", "error", *inputs,
        "-filter_complex", ";".join(chain),
        "-map", "[v]", "-map", "[a]", "-t", f"{total:.2f}",
        # The bitrate cap keeps busy footage (stars, water) from producing 30 MB files. Facebook re-encodes anyway.
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "24", "-maxrate", "2500k", "-bufsize", "5000k",
        "-pix_fmt", "yuv420p", "-r", str(FPS),
        "-c:a", "aac", "-ar", "48000", "-b:a", "160k", "-movflags", "+faststart", out.name,
    ]
    res = subprocess.run(cmd, cwd=work, capture_output=True, text=True)
    if res.returncode != 0:
        raise RuntimeError(f"ffmpeg failed: {res.stderr[-1500:]}")
    return total


def thumbnail(video: Path, out: Path, at: float = 1.5) -> Path:
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-ss", f"{at}", "-i", str(video), "-frames:v", "1",
                    "-vf", "scale=540:-2", "-q:v", "4", str(out)], check=True)
    return out
