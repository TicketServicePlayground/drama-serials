"""IXPAY deposits: SBP (Russia's Faster Payments System).

The deposit is created in the Eventstripe business unit, whose currency is IDR (public API,
https://ixpay-sea.com/docs/public): first a quote for the rupiah to be credited
(`calculate?direction=receive`), then the deposit bound to that quote, with the rubles the payer
pays (IXPAY's service markup on top) as `desired_amount`. The same unit's webhooks go to novacom-chat,
so the status is always read back from the API (the reconciler polls pending payments).
Successful deposits end as `confirmed` (payment_stage closed).
"""

import asyncio
import logging
from datetime import datetime
from typing import Any

import httpx

from app.config import settings
from app.models import Payment, PaymentStatus
from app.products import products
from app.providers.base import Checkout, ProviderError, Snapshot

logger = logging.getLogger(__name__)

#: Our idempotency key at IXPAY, so these deposits are told apart from novacom's.
REF_PREFIX = "AN-"

STATUS_MAP: dict[str, PaymentStatus] = {
    "confirmed": PaymentStatus.PAID,
    "completed": PaymentStatus.PAID,
    "expired": PaymentStatus.EXPIRED,
    "failed": PaymentStatus.FAILED,
    "cancelled": PaymentStatus.FAILED,
    "rejected": PaymentStatus.FAILED,
}


def _client() -> httpx.AsyncClient:
    if not settings.ixpay_api_key or not settings.ixpay_business_unit_id:
        raise ProviderError("ixpay is not configured")
    return httpx.AsyncClient(
        base_url=f"{settings.ixpay_base_url.rstrip('/')}/api/v1/public/v1/business-units/{settings.ixpay_business_unit_id}",
        headers={"X-API-Key": settings.ixpay_api_key, "Accept": "application/json"},
        timeout=settings.provider_timeout_seconds,
    )


def _url(data: dict[str, Any]) -> str | None:
    detail = data.get("deposit_detail") or {}
    return detail.get("payment_url") or detail.get("sbp_qr_url")


def _when(value: str | None) -> datetime | None:
    return datetime.fromisoformat(value.replace("Z", "+00:00")) if value else None


def snapshot(payment: Payment, data: Any) -> Snapshot:
    if not isinstance(data, dict) or str(data.get("id")) != payment.provider_payment_id:
        raise ProviderError("ixpay returned another deposit")
    raw_status = str(data.get("status") or "").lower()
    # pending and anything in between (preparing, review) keep the payment open.
    status = STATUS_MAP.get(raw_status, PaymentStatus.PENDING)
    detail = data.get("deposit_detail") or {}
    credited = detail.get("credited_amount_converted")
    return Snapshot(
        # IXPAY files the deposit under its own id; it was checked against ours above.
        ref=payment.provider_ref,
        status=status,
        amount=round(float(credited)) if credited is not None else None,
        currency=data.get("currency_code"),
        channel="SBP",
        raw=data,
    )


class IxpayProvider:
    def reference(self, payment: Payment) -> str:
        return f"{REF_PREFIX}{payment.id}"

    async def open(self, payment: Payment, *, payer_email: str | None, return_url: str) -> Checkout:
        body = {
            "payment_method": "sbp",
            "idempotency_key": payment.provider_ref,
            "return_url": return_url,
            "auto_redirect": True,
            "redirect_delay_seconds": 3,
            "notes": " · ".join(filter(None, [products()[payment.product].title, payer_email])),
        }
        try:
            async with _client() as client:
                # The rupiah to credit → the rubles to pay, as a quote the deposit is bound to.
                quote = await client.get("/calculate", params={"direction": "receive", "amount": payment.amount})
                if quote.status_code >= 400:
                    raise ProviderError(f"ixpay quote: {quote.status_code} {quote.text[:200]}")
                q = quote.json()
                if not q.get("can_initiate", True) or not q.get("quote_id"):
                    raise ProviderError(f"ixpay cannot take payments now: {q.get('blocked_reason')}")
                body |= {"quote_id": q["quote_id"], "desired_amount": q["give_amount"]}
                response = await client.post("/deposits", json=body)
                if response.status_code >= 400:
                    logger.warning("ixpay refused a deposit: %s %s", response.status_code, response.text[:300])
                    raise ProviderError(response.text[:200])
                data = response.json()
                deposit_id = data.get("id")
                # The payment link can take a few seconds (PAYMENT_PREPARING).
                for _ in range(10):
                    if _url(data) or not deposit_id:
                        break
                    await asyncio.sleep(1.5)
                    again = await client.get(f"/deposits/{deposit_id}")
                    if again.status_code < 400:
                        data = again.json()
        except httpx.HTTPError as error:
            raise ProviderError("ixpay did not answer") from error
        url = _url(data)
        if not url or not data.get("id"):
            raise ProviderError("ixpay returned no payment url")
        detail = data.get("deposit_detail") or {}
        return Checkout(
            url=url,
            provider_payment_id=str(data["id"]),
            expires_at=_when(detail.get("expires_at")),
            raw=data,
        )

    async def fetch(self, payment: Payment) -> Snapshot:
        if not payment.provider_payment_id:
            raise ProviderError("payment has no ixpay deposit")
        try:
            async with _client() as client:
                response = await client.get(f"/deposits/{payment.provider_payment_id}")
        except httpx.HTTPError as error:
            raise ProviderError("ixpay did not answer") from error
        if response.status_code >= 400:
            raise ProviderError(f"ixpay answered {response.status_code}")
        return snapshot(payment, response.json())
