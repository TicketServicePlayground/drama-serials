"""The site's own visit counter: page views in, the raw rows out for the team.

No cookies and no raw IPs are kept. A visitor is HMAC(secret, day + IP + browser), so one
person counts once per day, and the id changes the next day.
"""
import csv
import hashlib
import hmac
import io
import json
import re
from datetime import UTC, date, datetime, timedelta, timezone
from typing import Annotated
from urllib.parse import urlsplit

from fastapi import APIRouter, Query
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel
from sqlalchemy import text

from app.api import CurrentUser, Session
from app.config import settings
from app.models import Visit

router = APIRouter(prefix="/api/v1")

# Days start at midnight Bali time (WITA, UTC+8, no daylight saving): the team is there.
TZ = timezone(timedelta(hours=8))

BOT_RE = re.compile(
    r"bot|crawl|spider|slurp|headless|lighthouse|pagespeed|preview|externalhit|external-?agent|"
    r"facebookcatalog|whatsapp|telegram|discord|skype|curl|wget|python|httpx|go-http|java/|"
    r"node-fetch|axios|okhttp|scrapy|phantom|puppeteer|playwright|selenium|monitor|uptime",
    re.IGNORECASE,
)


def device_of(ua: str) -> str:
    if re.search(r"ipad|tablet", ua, re.IGNORECASE):
        return "tablet"
    if re.search(r"mobi|iphone|android", ua, re.IGNORECASE):
        return "mobile"
    return "desktop"


def visitor_id(ip: str, ua: str, now: datetime) -> str:
    day = now.astimezone(TZ).date().isoformat()
    message = f"{day}|{ip}|{ua}".encode()
    return hmac.new(settings.jwt_secret.encode(), message, hashlib.sha256).hexdigest()[:16]


# Coming back from a payment page is not a source: the visitor's first source stands.
PAYMENT_HOSTS = ("doku.com", "xendit.co", "ixpay-sea.com")


def referrer_host(referrer: str) -> str:
    host = (urlsplit(referrer).hostname or "") if referrer else ""
    host = host.removeprefix("www.").lower()
    # Moving around the site is not a source.
    site = (urlsplit(settings.public_site_url).hostname or "").removeprefix("www.")
    if any(host == h or host.endswith("." + h) for h in PAYMENT_HOSTS):
        return ""
    return "" if not host or host == site else host[:120]


COUNTRY_RE = re.compile(r"^[A-Z]{2}$")
CLIENT_ID_RE = re.compile(r"^[a-f0-9]{16,32}$")
# The data is raw: every visit, sign-up and payment is shown, whoever made it. Nothing here
# looks at users.is_test (that flag only keeps team purchases out of Meta, app/billing.py).


# Clicks on the way to paying, besides page views (event ""):
#   cover     - a series cover on the home page (target = slug)
#   auth_open - the sign-up / sign-in dialog was shown (target = why: watch, like, vip, generic)
#   episode   - an episode on a series page (target = "slug/number")
#   paywall   - the plans were shown (target = slug, or "vip" for the VIP page)
#   email_gate - "more episodes free for an email" was shown (target = "slug/number")
EVENTS = {"", "cover", "auth_open", "episode", "email_gate", "paywall"}
# The A/B test at the first locked episode: the plans at once, or an email for more free ones.
AB_GROUPS = {"paywall", "email"}


class PageView(BaseModel):
    path: str
    referrer: str = ""
    utm_source: str = ""
    utm_medium: str = ""
    utm_campaign: str = ""
    utm_content: str = ""
    fbclid: bool = False
    # ISO code from the proxy in front of the site (CF-IPCountry / nginx GeoIP); "" = unknown.
    country: str = ""
    lang: str = ""
    event: str = ""
    target: str = ""
    # Random id from the browser's storage (lib/track.ts): the same browser on other days.
    cid: str = ""
    # A/B group of this browser at the first locked episode: "paywall" or "email".
    ab: str = ""
    # Filled in by the site's server from the request, never by the browser.
    ip: str = ""
    ua: str = ""


@router.post("/visits", status_code=204)
async def track(body: PageView, user: CurrentUser, session: Session):
    if not body.path.startswith("/") or not body.ua or BOT_RE.search(body.ua) or body.event not in EVENTS:
        return None
    now = datetime.now(UTC)
    country = body.country.strip().upper()
    visit = Visit(
        at=now,
        visitor=visitor_id(body.ip, body.ua, now),
        path=body.path.split("?")[0][:300],
        referrer=referrer_host(body.referrer),
        utm_source=body.utm_source.strip().lower()[:80],
        utm_medium=body.utm_medium.strip().lower()[:80],
        utm_campaign=body.utm_campaign.strip()[:150],
        utm_content=body.utm_content.strip()[:150],
        fbclid=body.fbclid,
        country=country if COUNTRY_RE.match(country) and country not in ("XX", "T1") else "",
        lang=body.lang[:8],
        device=device_of(body.ua),
        event=body.event,
        target=body.target.strip()[:80],
        client_id=body.cid if CLIENT_ID_RE.match(body.cid) else "",
        ab=body.ab if body.ab in AB_GROUPS else "",
        user_id=user.id if user else None,
    )
    session.add(visit)
    if user is not None:
        if not user.is_test and user.email in settings.test_email_set:
            user.is_test = True
        if user.src_at is None:
            await _remember_first_source(session, user, visit)
        if not user.ab and visit.ab:
            user.ab = visit.ab
    await session.commit()
    return None


async def link_payer(session, user, ip: str, ua: str) -> None:
    """Ties the visitor-day a user starts paying from to them. Someone who signs up at paying
    (a guest by QRIS/SBP, an email at the paywall) and goes straight to the payment page sends
    no signed-in page view, so without this their sign-up and payment have no source or country.
    Marks the visitor's latest page view of the last day as theirs and takes its first source."""
    if not ip or not ua:
        return
    now = datetime.now(UTC)
    visitor = visitor_id(ip, ua, now)
    since = now - timedelta(hours=24)
    await session.execute(
        text(
            "UPDATE visits SET user_id = :user WHERE id = (SELECT id FROM visits WHERE visitor = :visitor "
            "AND at > :since AND user_id IS NULL AND NOT EXISTS (SELECT 1 FROM visits w "
            "WHERE w.visitor = :visitor AND w.at > :since AND w.user_id = :user) ORDER BY at DESC LIMIT 1)"
        ),
        {"user": user.id, "visitor": visitor, "since": since},
    )
    if user.src_at is None:
        await _remember_first_source(session, user, Visit(visitor=visitor, at=now))


async def _remember_first_source(session, user, visit: Visit) -> None:
    """The user's first signed-in visit: keep where this visitor came from today (the landing
    with its ad labels may have been before signing in), so later payments count for it."""
    await session.flush()
    rows = (
        await session.execute(
            text(
                "SELECT utm_source, utm_medium, utm_campaign, utm_content, referrer, country FROM visits "
                "WHERE visitor = :visitor AND at > :since ORDER BY at"
            ),
            {"visitor": visit.visitor, "since": visit.at - timedelta(hours=24)},
        )
    ).all()
    landing = next((r for r in rows if r.utm_source or r.utm_campaign or r.referrer), None)
    if landing is not None:
        user.src_source = (landing.utm_source or landing.referrer)[:120]
        user.src_medium = landing.utm_medium or None
        user.src_campaign = landing.utm_campaign or None
        user.src_content = landing.utm_content or None
    user.src_country = next((r.country for r in rows if r.country), None)
    user.src_at = visit.at


# --- raw data for the team ---------------------------------------------------------------------

# Tables as they are in the database, every column but password hashes. No counting, no merging:
# the team counts by itself. Times are UTC as stored.
RAW_TABLES = {
    "visits": "at",
    "users": "created_at",
    "payments": "created_at",
    "access_grants": "created_at",
    "episode_unlocks": "created_at",
}
HIDDEN_COLUMNS = {"password_hash"}
RAW_PAGE = 500


def _cell(value) -> str | int | float | bool | None:
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, (dict, list)):
        return json.dumps(value, ensure_ascii=False)
    return str(value)


@router.get("/raw")
async def raw(
    session: Session,
    key: Annotated[str, Query()] = "",
    table: Annotated[str, Query()] = "visits",
    start: Annotated[date | None, Query(alias="from")] = None,
    end: Annotated[date | None, Query(alias="to")] = None,
    page: Annotated[int, Query(ge=1)] = 1,
    format: Annotated[str, Query()] = "json",
):
    """Rows of one table, newest first, for the UTC days [from, to] (default: the last 7).
    JSON comes a page at a time; format=csv is the whole period in one file."""
    if not settings.stats_key or not hmac.compare_digest(key, settings.stats_key):
        return JSONResponse({"error": "not_found"}, status_code=404)
    if table not in RAW_TABLES:
        return JSONResponse({"error": "unknown_table"}, status_code=400)
    today = datetime.now(UTC).date()
    end = end or today
    start = start or end - timedelta(days=6)
    column = RAW_TABLES[table]
    # Table and column names come from RAW_TABLES only, never from the request.
    where = f"{column} >= :start AND {column} < :end"
    params = {
        "start": datetime.combine(start, datetime.min.time(), UTC),
        "end": datetime.combine(end + timedelta(days=1), datetime.min.time(), UTC),
    }
    total = (await session.execute(text(f"SELECT count(*) FROM {table} WHERE {where}"), params)).scalar_one()
    query = f"SELECT * FROM {table} WHERE {where} ORDER BY {column} DESC"
    if format != "csv":
        query += f" LIMIT {RAW_PAGE} OFFSET {(page - 1) * RAW_PAGE}"
    result = await session.execute(text(query), params)
    columns = [c for c in result.keys() if c not in HIDDEN_COLUMNS]
    rows = [[_cell(row._mapping[c]) for c in columns] for row in result]
    if format == "csv":
        out = io.StringIO()
        writer = csv.writer(out)
        writer.writerow(columns)
        writer.writerows(["" if v is None else v for v in row] for row in rows)
        name = f"{table}_{start.isoformat()}_{end.isoformat()}.csv"
        return Response(
            "\ufeff" + out.getvalue(),  # BOM: Excel reads it as UTF-8
            media_type="text/csv; charset=utf-8",
            headers={"Content-Disposition": f'attachment; filename="{name}"'},
        )
    return {
        "table": table,
        "tables": list(RAW_TABLES),
        "from": start.isoformat(),
        "to": end.isoformat(),
        "page": page,
        "page_size": RAW_PAGE,
        "total": total,
        "columns": columns,
        "rows": rows,
    }


@router.get("/series-views")
async def series_views(session: Session) -> dict:
    """Real plays for the showcase (instead of made-up counters): episode opens per series and
    per episode, all time."""
    rows = (
        await session.execute(
            text(
                f"SELECT target, count(*) AS n FROM visits WHERE event = 'episode' AND target LIKE '%/%' GROUP BY target"
            )
        )
    ).all()
    series: dict[str, int] = {}
    episodes: dict[str, int] = {}
    for target, n in rows:
        slug, _, number = target.partition("/")
        series[slug] = series.get(slug, 0) + n
        episodes[f"{slug}~{number}"] = n
    return {"series": series, "episodes": episodes}
