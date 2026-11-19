"""Telegram messages. Button presses are handled by the web app's webhook, not here."""

from functools import lru_cache

import httpx

from worker import db


@lru_cache(maxsize=1)
def _token() -> str:
    """Saved from the web Settings page; TELEGRAM_BOT_TOKEN env var as a fallback."""
    return db.secret("telegram_bot_token")


def _api(method: str, **payload) -> dict:
    token = _token()
    if not token:
        return {}
    r = httpx.post(f"https://api.telegram.org/bot{token}/{method}", json=payload, timeout=60)
    data = r.json()
    if not data.get("ok"):
        raise RuntimeError(f"Telegram {method}: {data.get('description')}")
    return data["result"]


def buttons(clip_id: str, mode: str) -> dict:
    if mode == "approval":
        rows = [[{"text": "✅ อนุมัติ", "callback_data": f"a:{clip_id}"},
                 {"text": "🚀 โพสต์เลย", "callback_data": f"p:{clip_id}"}],
                [{"text": "⏰ เลื่อน 1 ชม.", "callback_data": f"d:{clip_id}"},
                 {"text": "✖️ ยกเลิก", "callback_data": f"c:{clip_id}"}]]
    elif mode == "posted":
        rows = [[{"text": "🗑 ลบโพสต์", "callback_data": f"x:{clip_id}"}]]
    elif mode == "none":
        rows = []
    else:
        rows = [[{"text": "🚀 โพสต์เลย", "callback_data": f"p:{clip_id}"},
                 {"text": "⏰ เลื่อน 1 ชม.", "callback_data": f"d:{clip_id}"},
                 {"text": "✖️ ยกเลิก", "callback_data": f"c:{clip_id}"}]]
    return {"inline_keyboard": rows}


def send_video(chat_id, video_url: str, caption: str, markup: dict) -> int:
    try:
        res = _api("sendVideo", chat_id=chat_id, video=video_url, caption=caption[:1024],
                   parse_mode="HTML", reply_markup=markup, supports_streaming=True)
    except RuntimeError:
        # Large or slow files: fall back to a text message with the link.
        res = _api("sendMessage", chat_id=chat_id, text=f"{caption}\n\n{video_url}"[:4096],
                   parse_mode="HTML", reply_markup=markup)
    return res.get("message_id", 0)


def edit_caption(chat_id, message_id: int, caption: str, markup: dict) -> None:
    try:
        _api("editMessageCaption", chat_id=chat_id, message_id=message_id, caption=caption[:1024],
             parse_mode="HTML", reply_markup=markup)
    except RuntimeError:
        try:
            _api("editMessageText", chat_id=chat_id, message_id=message_id, text=caption[:4096],
                 parse_mode="HTML", reply_markup=markup)
        except RuntimeError:
            pass


def send(chat_id, text: str) -> None:
    if chat_id:
        _api("sendMessage", chat_id=chat_id, text=text[:4096], parse_mode="HTML", disable_web_page_preview=True)
