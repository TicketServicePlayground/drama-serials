"""Provider notifications, read from the Eventstripe database.

The payment accounts belong to Eventstripe, so Xendit, DOKU and IXPAY deliver their
notifications to the Eventstripe backend. It checks each one (Xendit callback token, DOKU
signature, IXPAY deposit re-read) and records every one in payment_events; ours (references
starting with "AN", IXPAY deposits noted "AN Serials: ...") are acknowledged there with outcome
IGNORED. IXPAY rows carry the deposit id in invoice_number. Older Xendit callbacks are only in xendit_webhook_logs. A notification found
here is a signal only: the payment is then re-read from the provider's API before anything
changes. Access is a read-only role limited to these two tables.
"""

import logging
from dataclasses import dataclass
from datetime import datetime

import asyncpg

from app.config import settings

logger = logging.getLogger(__name__)

_pool: asyncpg.Pool | None = None


@dataclass(frozen=True)
class HookSignal:
    provider: str
    ref: str
    status: str
    seen_at: datetime


async def _get_pool() -> asyncpg.Pool | None:
    global _pool
    if not settings.eventstripe_db_dsn:
        return None
    if _pool is None:
        _pool = await asyncpg.create_pool(
            settings.eventstripe_db_dsn,
            min_size=0,
            max_size=2,
            command_timeout=15,
            # Belt and braces on top of the read-only role.
            server_settings={"default_transaction_read_only": "on"},
        )
    return _pool


async def latest_signals(
    doku_refs: list[str], xendit_refs: list[str], ixpay_deposits: list[str] | None = None
) -> list[HookSignal]:
    """Newest notification status per reference (IXPAY: per deposit id). Empty when the source
    is not configured."""
    ixpay_deposits = ixpay_deposits or []
    pool = await _get_pool()
    if pool is None or not (doku_refs or xendit_refs or ixpay_deposits):
        return []
    schema = settings.eventstripe_db_schema
    signals: list[HookSignal] = []
    async with pool.acquire() as connection:
        refs = doku_refs + xendit_refs + ixpay_deposits
        rows = await connection.fetch(
            f"""
            SELECT DISTINCT ON (provider, invoice_number)
                   provider, invoice_number, provider_status, created_at
            FROM {schema}.payment_events
            WHERE provider IN ('doku', 'xendit', 'ixpay') AND direction = 'IN' AND operation = 'WEBHOOK'
              AND outcome <> 'REJECTED' AND invoice_number = ANY($1::text[])
            ORDER BY provider, invoice_number, created_at DESC
            """,
            refs,
        )
        signals += [
            HookSignal(
                r["provider"],
                r["invoice_number"],
                (r["provider_status"] or "").upper(),
                r["created_at"],
            )
            for r in rows
        ]
        if xendit_refs:
            rows = await connection.fetch(
                f"""
                SELECT DISTINCT ON (payload::jsonb->>'external_id')
                       payload::jsonb->>'external_id' AS ref,
                       payload::jsonb->>'status' AS status, processed_at
                FROM {schema}.xendit_webhook_logs
                WHERE payload::jsonb->>'external_id' = ANY($1::text[])
                ORDER BY payload::jsonb->>'external_id', processed_at DESC
                """,
                xendit_refs,
            )
            signals += [
                HookSignal("xendit", r["ref"], (r["status"] or "").upper(), r["processed_at"])
                for r in rows
            ]
    return signals


async def close() -> None:
    global _pool
    if _pool is not None:
        await _pool.close()
        _pool = None
