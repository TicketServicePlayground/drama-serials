"""VIP points: a daily award for watching, exchanged for VIP days.

A VIP (active pass) who opens an episode gets `points_daily` once per Bali day; the API's play
endpoint calls award_daily. `points_per_vip_day` points buy one day of VIP access, added after
the current access like a paid pass.
"""
import logging
import uuid
from datetime import UTC, date, datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, Request
from pydantic import BaseModel, Field
from sqlalchemy import func, select, text
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.api import CurrentUser, Session, account, client_ip, error
from app.billing import access_until
from app.config import settings
from app.models import AccessGrant, PointsEntry, User
from app.visits import TZ

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/v1")

DAILY = "daily_watch"
REDEEM = "redeem"


def today() -> date:
    return datetime.now(TZ).date()


async def balance(session: AsyncSession, user_id: uuid.UUID) -> int:
    total = await session.scalar(select(func.coalesce(func.sum(PointsEntry.delta), 0)).where(PointsEntry.user_id == user_id))
    return int(total or 0)


async def award_daily(session: AsyncSession, user_id: uuid.UUID) -> int:
    """Today's award, once: returns the points given now (0 if already given today)."""
    given = await session.scalar(
        insert(PointsEntry)
        .values(id=uuid.uuid4(), user_id=user_id, delta=settings.points_daily, reason=DAILY, day=today())
        .on_conflict_do_nothing(index_elements=["user_id", "day"], index_where=text("reason = 'daily_watch'"))
        .returning(PointsEntry.id)
    )
    await session.commit()
    return settings.points_daily if given else 0


@router.get("/me/points")
async def my_points(user: CurrentUser, session: Session):
    if user is None:
        return error("unauthorized", 401)
    history = (
        await session.scalars(
            select(PointsEntry).where(PointsEntry.user_id == user.id).order_by(PointsEntry.created_at.desc()).limit(30)
        )
    ).all()
    earned_today = await session.scalar(
        select(PointsEntry.id).where(PointsEntry.user_id == user.id, PointsEntry.reason == DAILY, PointsEntry.day == today())
    )
    return {
        "balance": await balance(session, user.id),
        "earned_today": earned_today is not None,
        "daily": settings.points_daily,
        "per_vip_day": settings.points_per_vip_day,
        "history": [
            {"at": e.created_at.isoformat(), "delta": e.delta, "reason": e.reason} for e in history
        ],
    }


class Redeem(BaseModel):
    days: Annotated[int, Field(ge=1, le=365)] = 1


@router.post("/points/redeem")
async def redeem(body: Redeem, request: Request, user: CurrentUser, session: Session):
    """Exchanges points for VIP days, added after the current access."""
    if user is None:
        return error("unauthorized", 401)
    # One exchange at a time per user, so two clicks cannot spend the same points twice.
    await session.execute(select(User.id).where(User.id == user.id).with_for_update())
    cost = body.days * settings.points_per_vip_day
    if await balance(session, user.id) < cost:
        await session.rollback()
        return error("not_enough_points", 400)
    entry = PointsEntry(id=uuid.uuid4(), user_id=user.id, delta=-cost, reason=REDEEM)
    session.add(entry)
    await session.flush()
    now = datetime.now(UTC)
    current = await access_until(session, user.id)
    starts = max(now, current) if current else now
    session.add(
        AccessGrant(user_id=user.id, points_entry_id=entry.id, starts_at=starts, ends_at=starts + timedelta(days=body.days))
    )
    await session.commit()
    logger.info("audit points-redeem user=%s days=%s points=%s ip=%s", user.id, body.days, cost, client_ip(request))
    return {"balance": await balance(session, user.id), "account": await account(session, user)}
