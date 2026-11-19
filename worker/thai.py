"""Line breaking for Thai on-screen text. Thai has no spaces between words, so the renderer cannot wrap it."""

import re

# Above/below vowels and tone marks attach to the previous character.
_COMBINING = re.compile(r"[ัิ-ฺ็-๎]")
# Leading vowels sit before their consonant and must not end a line.
_LEADING = set("เแโใไ")


def clusters(text: str) -> list[str]:
    out: list[str] = []
    for ch in text:
        if out and (_COMBINING.match(ch) or out[-1][-1] in _LEADING):
            out[-1] += ch
        else:
            out.append(ch)
    return out


def visible_len(text: str) -> int:
    return len(clusters(text))


def _hard_split(text: str, width: int) -> list[str]:
    cs = clusters(text)
    return ["".join(cs[i:i + width]) for i in range(0, len(cs), width)]


def wrap(text: str, width: int, max_lines: int = 3) -> list[str]:
    lines: list[str] = []
    for chunk in str(text).split("|"):
        chunk = chunk.strip()
        if not chunk:
            continue
        current = ""
        for word in chunk.split(" "):
            candidate = f"{current} {word}".strip()
            if visible_len(candidate) <= width:
                current = candidate
                continue
            if current:
                lines.append(current)
            if visible_len(word) > width:
                pieces = _hard_split(word, width)
                lines.extend(pieces[:-1])
                current = pieces[-1]
            else:
                current = word
        if current:
            lines.append(current)
    return lines[:max_lines]
