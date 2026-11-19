from functools import lru_cache
from pathlib import Path

from supabase import Client, create_client

from worker import config
from worker.crypto import decrypt


@lru_cache(maxsize=1)
def client() -> Client:
    if not config.SUPABASE_URL or not config.SUPABASE_SERVICE_KEY:
        raise RuntimeError("SUPABASE_URL and SUPABASE_SERVICE_KEY must be set")
    return create_client(config.SUPABASE_URL, config.SUPABASE_SERVICE_KEY)


def table(name: str):
    return client().table(name)


def settings() -> dict:
    rows = table("settings").select("key,value").execute().data
    return {r["key"]: r["value"] for r in rows}


def set_setting(key: str, value) -> None:
    table("settings").upsert({"key": key, "value": value}).execute()


def secret(key: str) -> str:
    rows = table("secrets").select("value_enc").eq("key", key).execute().data
    if rows:
        return decrypt(rows[0]["value_enc"])
    return config.ENV_SECRETS.get(key, "")


def upload(local: Path, remote: str, content_type: str) -> str:
    storage = client().storage.from_(config.BUCKET)
    with open(local, "rb") as f:
        storage.upload(remote, f.read(), {"content-type": content_type, "upsert": "true"})
    return remote


def public_url(path: str) -> str:
    return f"{config.SUPABASE_URL}/storage/v1/object/public/{config.BUCKET}/{path}"


def remove(paths: list[str]) -> None:
    if paths:
        client().storage.from_(config.BUCKET).remove(paths)
