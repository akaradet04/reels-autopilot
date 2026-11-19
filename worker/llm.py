"""Language model calls. Provider and model come from the web settings page."""

import json
import logging
import re

import httpx

from worker import db

log = logging.getLogger("worker")

# Tried in order after the model chosen in Settings. Google retires model names and the
# "-latest" aliases are sometimes overloaded (503), so production never depends on one model.
GEMINI_FALLBACKS = ["gemini-flash-latest", "gemini-3.1-flash-lite", "gemini-flash-lite-latest"]
RETRYABLE = {404, 429, 500, 503}


def _gemini(prompt: str, model: str, temperature: float = 0.9) -> str:
    key = db.secret("gemini_api_key")
    body = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {"temperature": temperature, "responseMimeType": "application/json"},
    }
    errors = []
    for name in dict.fromkeys([m for m in [model, *GEMINI_FALLBACKS] if m]):
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{name}:generateContent"
        # Header works for both key formats (AIza... and the newer AQ....).
        try:
            r = httpx.post(url, headers={"x-goog-api-key": key}, json=body, timeout=45)
        except httpx.TimeoutException:
            errors.append(f"{name}: timeout")  # an overloaded model can hang: move on to the next one
            continue
        if r.status_code in RETRYABLE:
            errors.append(f"{name}: {r.status_code}")
            continue
        r.raise_for_status()
        return r.json()["candidates"][0]["content"]["parts"][0]["text"]
    raise RuntimeError("Gemini ไม่ว่างทุกรุ่น ลองใหม่รอบถัดไป (" + ", ".join(errors) + ")")


def _openai_compatible(prompt: str, model: str, base: str, key: str, temperature: float = 0.9) -> str:
    r = httpx.post(
        f"{base}/chat/completions",
        headers={"Authorization": f"Bearer {key}"},
        json={
            "model": model,
            "messages": [{"role": "user", "content": prompt}],
            "temperature": temperature,
            "response_format": {"type": "json_object"},
        },
        timeout=90,
    )
    r.raise_for_status()
    return r.json()["choices"][0]["message"]["content"]


# Groq retires models without notice (llama-3.3-70b-versatile was gone by the time the key was saved), so a short list
# of tested models is tried in order. All three wrote valid Thai JSON in testing; allam-2-7b did not and is not used.
GROQ_MODELS = ["openai/gpt-oss-120b", "qwen/qwen3.8-27b", "openai/gpt-oss-20b"]
DEFAULT_MODELS = {"gemini": "gemini-flash-latest", "groq": GROQ_MODELS[0], "openai": "gpt-4o-mini"}
BASES = {"groq": "https://api.groq.com/openai/v1", "openai": "https://api.openai.com/v1"}


def _groq(prompt: str, model: str, temperature: float = 0.9) -> str:
    key = db.secret("groq_api_key")
    errors = []
    for name in dict.fromkeys([m for m in [model, *GROQ_MODELS] if m]):
        try:
            return _openai_compatible(prompt, name, BASES["groq"], key, temperature)
        except httpx.HTTPStatusError as e:
            if e.response.status_code in RETRYABLE | {400}:  # retired, rate-limited or not able to answer in JSON
                errors.append(f"{name}: {e.response.status_code}")
                continue
            raise
        except httpx.TimeoutException:
            errors.append(f"{name}: timeout")
    raise RuntimeError("Groq ไม่ว่างทุกรุ่น (" + ", ".join(errors) + ")")

# Backups, free first and paid last. A provider is only tried when its key has been saved in Settings.
LLM_CHAIN = ["gemini", "groq", "openai"]


def generate_json(prompt: str, providers: dict, temperature: float = 0.9) -> dict:
    first = providers.get("llm", "gemini")
    order = [first] + [p for p in LLM_CHAIN if p != first]
    errors = []
    for name in order:
        if not db.secret(f"{name}_api_key"):
            continue
        # The model name typed in Settings belongs to the chosen provider only.
        model = (providers.get("llm_model") if name == first else "") or DEFAULT_MODELS.get(name, "")
        try:
            if name == "gemini":
                raw = _gemini(prompt, model, temperature)
            elif name == "groq":
                raw = _groq(prompt, model, temperature)
            else:
                raw = _openai_compatible(prompt, model, BASES[name], db.secret(f"{name}_api_key"), temperature)
            return parse_json(raw)
        except (httpx.HTTPError, RuntimeError, ValueError, KeyError, IndexError) as e:
            errors.append(f"{name}: {e}")
            log.warning("script writer %s failed, trying the next: %s", name, e)
    raise RuntimeError("เขียนบทไม่ได้ " + ("; ".join(errors) if errors else "ยังไม่ได้ใส่คีย์ของบริการเขียนบท"))


def parse_json(raw: str) -> dict:
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        m = re.search(r"\{.*\}", raw, re.DOTALL)
        if not m:
            raise ValueError(f"Model did not return JSON: {raw[:200]}")
        return json.loads(m.group(0))
