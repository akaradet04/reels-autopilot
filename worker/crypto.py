"""AES-256-GCM, byte-compatible with web/lib/crypto.ts: base64(iv[12] | ciphertext | tag[16])."""

import base64
import hashlib
import os

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from worker.config import ENCRYPTION_KEY


def _key() -> bytes:
    if not ENCRYPTION_KEY:
        raise RuntimeError("ENCRYPTION_KEY is not set")
    return hashlib.sha256(ENCRYPTION_KEY.encode()).digest()


def encrypt(plain: str) -> str:
    iv = os.urandom(12)
    ct = AESGCM(_key()).encrypt(iv, plain.encode(), None)
    return base64.b64encode(iv + ct).decode()


def decrypt(token: str) -> str:
    raw = base64.b64decode(token)
    return AESGCM(_key()).decrypt(raw[:12], raw[12:], None).decode()
