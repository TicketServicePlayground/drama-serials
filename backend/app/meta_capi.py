"""Meta Conversions API: the Purchase event sent from the server.

The browser pixel (components/MetaPixel.tsx) reports a purchase only if the payer comes back
to /payment/<id>. QRIS payers often close the tab after paying in their bank app, so those
purchases never reach Meta and campaigns cannot optimise for them. Here the same event goes
out from the server the moment a payment turns paid. Both carry event_id = payment id, so Meta
counts a purchase once when it gets it from both sides.

No email or name is sent: only what the pixel itself sees (IP, browser, the _fbp/_fbc cookies),
captured when the payment was opened (Payment.ad_context).

Fire-and-forget like app/notify.py. Off when META_PIXEL_ID or META_CAPI_TOKEN is empty.
"""

import asyncio
import hashlib
import logging

import httpx

from app.config import settings
from app.models import Payment

logger = logging.getLogger(__name__)

GRAPH_URL = "https://graph.facebook.com/v21.0"
_pending: set[asyncio.Task] = set()


def enabled() -> bool:
    return bool(settings.meta_pixel_id and settings.meta_capi_token)


def purchase_event(payment: Payment) -> dict:
    context = payment.ad_context or {}
    user_data = {
        key: value
        for key, value in {
            "client_ip_address": context.get("ip"),
            "client_user_agent": context.get("ua"),
            "fbp": context.get("fbp"),
            "fbc": context.get("fbc"),
            # Our account id, hashed: ties repeat purchases to one buyer; not personal data.
            "external_id": hashlib.sha256(str(payment.user_id).encode()).hexdigest(),
        }.items()
        if value
    }
    paid_at = payment.paid_at or payment.created_at
    return {
        "event_name": "Purchase",
        "event_time": int(paid_at.timestamp()),
        "event_id": str(payment.id),
        "action_source": "website",
        "event_source_url": f"{settings.public_site_url}/payment/{payment.id}",
        "user_data": user_data,
        "custom_data": {
            "value": payment.amount,
            "currency": payment.currency,
            "content_name": payment.product,
            "content_type": "product",
            **({"content_ids": [payment.target_slug]} if payment.target_slug else {}),
        },
    }


async def _send(payload: dict) -> None:
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.post(
                f"{GRAPH_URL}/{settings.meta_pixel_id}/events",
                params={"access_token": settings.meta_capi_token},
                json=payload,
            )
        if response.status_code >= 400:
            logger.warning("meta capi refused: %s %s", response.status_code, response.text[:300])
    except httpx.HTTPError as error:
        logger.warning("meta capi unreachable: %s", error)


def send(payload: dict) -> None:
    task = asyncio.get_running_loop().create_task(_send(payload))
    _pending.add(task)
    task.add_done_callback(_pending.discard)


def purchase(payment: Payment) -> None:
    if not enabled():
        return
    payload: dict = {"data": [purchase_event(payment)]}
    if settings.meta_test_event_code:
        payload["test_event_code"] = settings.meta_test_event_code
    send(payload)
