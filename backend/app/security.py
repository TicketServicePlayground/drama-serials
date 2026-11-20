import hashlib
import hmac
import re
import secrets
import uuid
from datetime import UTC, datetime, timedelta

import jwt

from app.config import settings

EMAIL_RE = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")

# Same parameters and "salt:hash" hex layout as Node's crypto.scrypt defaults, so accounts
# created by the first, Node-only version of the site keep their passwords.
SCRYPT_N, SCRYPT_R, SCRYPT_P, SCRYPT_LEN = 16384, 8, 1, 64


def normalize_email(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    email = value.strip().lower()
    return email if len(email) <= 254 and EMAIL_RE.match(email) else None


def valid_password(value: object) -> bool:
    return isinstance(value, str) and 6 <= len(value) <= 200


def _scrypt(password: str, salt: bytes, length: int) -> bytes:
    return hashlib.scrypt(
        password.encode(),
        salt=salt,
        n=SCRYPT_N,
        r=SCRYPT_R,
        p=SCRYPT_P,
        dklen=length,
        maxmem=64 * 1024 * 1024,
    )


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    return f"{salt.hex()}:{_scrypt(password, salt, SCRYPT_LEN).hex()}"


def verify_password(password: str, stored: str) -> bool:
    salt_hex, _, hash_hex = stored.partition(":")
    if not salt_hex or not hash_hex:
        return False
    expected = bytes.fromhex(hash_hex)
    actual = _scrypt(password, bytes.fromhex(salt_hex), len(expected))
    return hmac.compare_digest(actual, expected)


def issue_token(user_id: uuid.UUID) -> str:
    now = datetime.now(UTC)
    payload = {"sub": str(user_id), "iat": now, "exp": now + timedelta(days=settings.jwt_ttl_days)}
    return jwt.encode(payload, settings.jwt_secret, algorithm="HS256")


def read_token(token: str) -> uuid.UUID | None:
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=["HS256"])
        return uuid.UUID(payload["sub"])
    except (jwt.PyJWTError, KeyError, ValueError):
        return None


def return_key(payment_id: uuid.UUID) -> str:
    """Signs a payment id for the link the provider sends the payer back to. A guest who paid in
    one browser (Instagram's, say) and comes back in another gets signed in by this key."""
    mac = hmac.new(settings.jwt_secret.encode(), f"return:{payment_id}".encode(), hashlib.sha256)
    return mac.hexdigest()[:32]


def check_return_key(payment_id: uuid.UUID, key: str) -> bool:
    return hmac.compare_digest(return_key(payment_id), key or "")


# A sign-in link to carry the session to another browser (Instagram's -> Safari, say).
TRANSFER_TTL = timedelta(days=7)


def issue_transfer_token(user_id: uuid.UUID) -> str:
    now = datetime.now(UTC)
    payload = {"sub": str(user_id), "purpose": "transfer", "iat": now, "exp": now + TRANSFER_TTL}
    return jwt.encode(payload, settings.jwt_secret, algorithm="HS256")


def read_transfer_token(token: str) -> uuid.UUID | None:
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=["HS256"])
        if payload.get("purpose") != "transfer":
            return None
        return uuid.UUID(payload["sub"])
    except (jwt.PyJWTError, KeyError, ValueError):
        return None


# A code emailed to confirm an address (the "more free episodes" offer): good this long.
EMAIL_CODE_TTL = timedelta(minutes=15)


def _code_digest(email: str, code: str) -> str:
    return hmac.new(settings.jwt_secret.encode(), f"{email}:{code}".encode(), hashlib.sha256).hexdigest()


def issue_email_challenge(email: str, code: str) -> str:
    """What the browser keeps between "send me a code" and typing it: the address and a keyed
    hash of the code (not the code itself), signed, for EMAIL_CODE_TTL."""
    now = datetime.now(UTC)
    payload = {
        "purpose": "email_code",
        "email": email,
        "ch": _code_digest(email, code),
        "jti": secrets.token_hex(8),
        "iat": now,
        "exp": now + EMAIL_CODE_TTL,
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm="HS256")


def read_email_challenge(token: str) -> dict | None:
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=["HS256"])
    except jwt.PyJWTError:
        return None
    return payload if payload.get("purpose") == "email_code" else None


def code_matches(challenge: dict, email: str, code: str) -> bool:
    return challenge.get("email") == email and hmac.compare_digest(
        challenge.get("ch", ""), _code_digest(email, code.strip())
    )
