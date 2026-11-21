"""What the visitor's browser says about itself, sent by the site with sign-ups and payments.

The browser keeps the ad label of the last link it came by (utm_*), its A/B group and its
counter id (lib/track.ts) in the cookie an_src; the site passes that cookie on as X-Label. Taken
as is: nothing is looked up, guessed or merged.
"""
import json
import re
from dataclasses import dataclass
from datetime import UTC, datetime
from urllib.parse import unquote

from fastapi import Request

CLIENT_ID_RE = re.compile(r"^[a-f0-9]{16,32}$")
AB_GROUPS = {"paywall", "email"}


@dataclass(frozen=True)
class Label:
    utm_source: str = ""
    utm_medium: str = ""
    utm_campaign: str = ""
    utm_content: str = ""
    ab: str = ""
    client_id: str = ""
    country: str = ""


def label_of(request: Request) -> Label:
    country = request.headers.get("x-country", "").strip().upper()
    country = country if re.fullmatch(r"[A-Z]{2}", country) else ""
    try:
        data = json.loads(unquote(request.headers.get("x-label", "")[:2000]) or "{}")
    except ValueError:
        data = {}
    if not isinstance(data, dict):
        data = {}
    text = lambda key, size: str(data.get(key) or "").strip()[:size]  # noqa: E731
    cid = text("cid", 32)
    ab = text("ab", 16)
    return Label(
        utm_source=text("utm_source", 80).lower(),
        utm_medium=text("utm_medium", 80).lower(),
        utm_campaign=text("utm_campaign", 150),
        utm_content=text("utm_content", 150),
        ab=ab if ab in AB_GROUPS else "",
        client_id=cid if CLIENT_ID_RE.match(cid) else "",
        country=country,
    )


def stamp_new_user(user, label: Label) -> None:
    """A new account keeps the label of the browser it was made in (users.src_*, users.ab)."""
    user.src_source = label.utm_source or None
    user.src_medium = label.utm_medium or None
    user.src_campaign = label.utm_campaign or None
    user.src_content = label.utm_content or None
    user.src_country = label.country or None
    user.src_at = datetime.now(UTC)
    if label.ab:
        user.ab = label.ab


def stamp_payment(payment, label: Label) -> None:
    payment.utm_source = label.utm_source
    payment.utm_medium = label.utm_medium
    payment.utm_campaign = label.utm_campaign
    payment.utm_content = label.utm_content
    payment.country = label.country
    payment.ab = label.ab
    payment.client_id = label.client_id
