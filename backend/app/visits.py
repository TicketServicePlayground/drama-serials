"""The site's own visit counter: page views in, a summary for the team out.

No cookies and no raw IPs are kept. A visitor is HMAC(secret, day + IP + browser), so one
person counts once per day, and the id changes the next day.
"""
import hashlib
import hmac
import re
from datetime import UTC, datetime, timedelta, timezone
from typing import Annotated
from urllib.parse import urlsplit

from fastapi import APIRouter, Query
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from sqlalchemy import text

from app.api import CurrentUser, Session
from app.config import settings
from app.models import Visit

router = APIRouter(prefix="/api/v1")

# Days start at midnight Bali time (WITA, UTC+8, no daylight saving): the team is there.
TZ_NAME = "Asia/Makassar"
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
# Visits of test accounts' visitor-days are left out (the same person before signing in too).
LIVE_VISITS = f"""(SELECT * FROM visits lv WHERE NOT EXISTS (
    SELECT 1 FROM visits t JOIN users u ON u.id = t.user_id
    WHERE u.is_test AND t.visitor = lv.visitor
      AND (t.at AT TIME ZONE '{TZ_NAME}')::date = (lv.at AT TIME ZONE '{TZ_NAME}')::date)) AS visits"""
LIVE_USER = " AND user_id NOT IN (SELECT id FROM users WHERE is_test)"


# Clicks on the way to paying, besides page views (event ""):
#   cover     - a series cover on the home page (target = slug)
#   auth_open - the sign-up / sign-in dialog was shown (target = why: watch, like, vip, generic)
#   episode   - an episode on a series page (target = "slug/number")
#   paywall   - the plans were shown (target = slug, or "vip" for the VIP page)
EVENTS = {"", "cover", "auth_open", "episode", "paywall"}


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
        user_id=user.id if user else None,
    )
    session.add(visit)
    if user is not None:
        if not user.is_test and user.email in settings.test_email_set:
            user.is_test = True
        if user.src_at is None:
            await _remember_first_source(session, user, visit)
    await session.commit()
    return None


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


def _rows(result) -> list[dict]:
    return [dict(row._mapping) for row in result]


@router.get("/stats")
async def stats(session: Session, key: Annotated[str, Query()] = "", tests: bool = False):
    if not settings.stats_key or not hmac.compare_digest(key, settings.stats_key):
        return JSONResponse({"error": "not_found"}, status_code=404)

    tz = {"tz": TZ_NAME}
    day = "(at AT TIME ZONE :tz)::date"
    V = "visits" if tests else LIVE_VISITS
    U = "" if tests else LIVE_USER
    today = datetime.now(TZ).date()

    async def totals(since_days: int, until_days: int = -1) -> dict:
        # Days counted back from today: [today - since_days, today - until_days).
        params = {**tz, "start": today - timedelta(days=since_days), "end": today - timedelta(days=until_days)}
        visits = (
            await session.execute(
                text(
                    f"SELECT count(*) AS views, count(DISTINCT ({day}, visitor)) AS visitors, "
                    f"count(DISTINCT ({day}, visitor)) FILTER (WHERE user_id IS NOT NULL) AS signed_in "
                    f"FROM {V} WHERE event = '' AND {day} >= :start AND {day} < :end"
                ),
                params,
            )
        ).one()
        signups = (
            await session.execute(
                text(
                    "SELECT count(*) FROM users WHERE " + ("" if tests else "NOT is_test AND ") + "(created_at AT TIME ZONE :tz)::date >= :start "
                    "AND (created_at AT TIME ZONE :tz)::date < :end"
                ),
                params,
            )
        ).scalar_one()
        paid = (
            await session.execute(
                text(
                    "SELECT count(*) AS paid, coalesce(sum(amount), 0) AS revenue FROM payments "
                    "WHERE status = 'paid'" + U + " AND (paid_at AT TIME ZONE :tz)::date >= :start "
                    "AND (paid_at AT TIME ZONE :tz)::date < :end"
                ),
                params,
            )
        ).one()
        return {
            "visitors": visits.visitors,
            "views": visits.views,
            "signed_in": visits.signed_in,
            "signups": signups,
            "paid": paid.paid,
            "revenue": int(paid.revenue),
        }

    week = {**tz, "start": today - timedelta(days=6)}

    async def top(column: str, limit: int = 10) -> list[dict]:
        return _rows(
            await session.execute(
                text(
                    f"SELECT {column} AS name, count(*) AS views, count(DISTINCT ({day}, visitor)) AS visitors "
                    f"FROM {V} WHERE event = '' AND {day} >= :start AND {column} <> '' "
                    f"GROUP BY {column} ORDER BY visitors DESC, views DESC LIMIT {limit}"
                ),
                week,
            )
        )

    by_day = _rows(
        await session.execute(
            text(
                f"""
                WITH days AS (
                  SELECT generate_series(CAST(:start AS date), CAST(:today AS date), interval '1 day')::date AS d
                )
                SELECT days.d AS day,
                  (SELECT count(DISTINCT visitor) FROM {V} WHERE event = '' AND {day} = days.d) AS visitors,
                  (SELECT count(*) FROM {V} WHERE event = '' AND {day} = days.d) AS views,
                  (SELECT count(*) FROM users WHERE {"" if tests else "NOT is_test AND "}(created_at AT TIME ZONE :tz)::date = days.d) AS signups,
                  (SELECT count(*) FROM payments WHERE status = 'paid'{U}
                     AND (paid_at AT TIME ZONE :tz)::date = days.d) AS paid
                FROM days ORDER BY days.d DESC
                """
            ),
            {**tz, "start": today - timedelta(days=13), "today": today},
        )
    )
    recent = _rows(
        await session.execute(
            text(
                "SELECT at, visitor, path, referrer, utm_source, lang, device, country, "
                f"(user_id IS NOT NULL) AS signed_in FROM {V} WHERE event = '' ORDER BY at DESC LIMIT 50"
            )
        )
    )
    for row in recent:
        row["at"] = row["at"].isoformat()
    for row in by_day:
        row["day"] = row["day"].isoformat()

    return {
        "timezone": TZ_NAME,
        "today": await totals(0),
        "yesterday": await totals(1, 0),
        "week": await totals(6),
        "month": await totals(29),
        "by_day": by_day,
        "pages": await top("path"),
        "referrers": await top("referrer"),
        "utm": await top("utm_source"),
        "langs": await top("lang"),
        "devices": await top("device"),
        "recent": recent,
    }


# --- funnel ------------------------------------------------------------------------------------

# Steps in order; each counts visitor-days (one person on one day) that reached it.
FUNNEL_STEPS = ["visit", "cover", "auth_open", "signup", "series", "episode", "paywall", "checkout", "paid"]
PERIODS = {"today": (0, -1), "yesterday": (1, 0), "7d": (6, -1), "30d": (29, -1)}


@router.get("/funnel")
async def funnel(
    session: Session,
    key: Annotated[str, Query()] = "",
    period: Annotated[str, Query()] = "7d",
    country: Annotated[str, Query()] = "",
    tests: bool = False,
):
    """The way from the first page to a payment, per visitor-day, for paid traffic.

    A visitor-day is the same daily id as in /stats. It stays the same before and after signing
    in (same IP and browser), so sign-ups and payments are tied to it through visits.user_id:
    a visitor-day "signed up" when a user it was signed in as was created that day, and
    "started paying" / "paid" when that user opened / settled a payment that day (its revenue).
    Its source, campaign, ad and country are those of its first visit that has them.

    Payments a day or more after the visit are counted again by the user's first source
    (users.src_*), in `paid_by_source` / `revenue_by_source` of the campaign and country tables.
    Test accounts (TEST_EMAILS) and their visitor-days are left out unless `tests`.
    `country` (ISO code) narrows everything to visitors from there.
    """
    if not settings.stats_key or not hmac.compare_digest(key, settings.stats_key):
        return JSONResponse({"error": "not_found"}, status_code=404)
    since, until = PERIODS.get(period, PERIODS["7d"])
    today = datetime.now(TZ).date()
    country = country.strip().upper() if COUNTRY_RE.match(country.strip().upper()) else ""
    params = {
        "tz": TZ_NAME,
        "start": today - timedelta(days=since),
        "end": today - timedelta(days=until),
        "country": country,
    }
    V = "visits" if tests else LIVE_VISITS
    U = "" if tests else LIVE_USER
    paid_day = "(p.created_at AT TIME ZONE :tz)::date = vd.d"

    per_visitor = f"""
        WITH v AS (
          SELECT (at AT TIME ZONE :tz)::date AS d, * FROM {V}
          WHERE (at AT TIME ZONE :tz)::date >= :start AND (at AT TIME ZONE :tz)::date < :end
        ), vd AS (
          SELECT d, visitor,
            coalesce((array_agg(utm_source ORDER BY at) FILTER (WHERE utm_source <> ''))[1],
                     (array_agg(referrer ORDER BY at) FILTER (WHERE referrer <> ''))[1], '') AS source,
            coalesce((array_agg(utm_campaign ORDER BY at) FILTER (WHERE utm_campaign <> ''))[1], '') AS campaign,
            coalesce((array_agg(utm_content ORDER BY at) FILTER (WHERE utm_content <> ''))[1], '') AS content,
            coalesce((array_agg(country ORDER BY at) FILTER (WHERE country <> ''))[1], '') AS country,
            bool_or(event = '') AS visit,
            bool_or(event = 'cover') AS cover,
            bool_or(event = 'auth_open') AS auth_open,
            bool_or(event = '' AND path LIKE '/series/%') AS series,
            bool_or(event = 'episode') AS episode,
            bool_or(event = 'paywall') AS paywall,
            array_agg(DISTINCT user_id) FILTER (WHERE user_id IS NOT NULL) AS users
          FROM v GROUP BY d, visitor
        ), steps AS (
          SELECT vd.*,
            EXISTS (SELECT 1 FROM users u WHERE u.id = ANY(vd.users)
                    AND (u.created_at AT TIME ZONE :tz)::date = vd.d) AS signup,
            EXISTS (SELECT 1 FROM payments p WHERE p.user_id = ANY(vd.users) AND {paid_day}) AS checkout,
            EXISTS (SELECT 1 FROM payments p WHERE p.user_id = ANY(vd.users) AND p.status = 'paid'
                    AND {paid_day}) AS paid,
            coalesce((SELECT sum(p.amount) FROM payments p WHERE p.user_id = ANY(vd.users)
                      AND p.status = 'paid' AND {paid_day}), 0) AS revenue
          FROM vd
          WHERE (:country = '' OR vd.country = :country)
        )
    """
    counts = ", ".join(f"count(*) FILTER (WHERE {s}) AS {s}" for s in FUNNEL_STEPS if s != "visit")
    reached = "count(*) FILTER (WHERE visit OR cover OR episode OR paywall) AS visit"

    async def grouped(columns: str, order: str) -> list[dict]:
        rows = _rows(
            await session.execute(
                text(
                    f"{per_visitor} SELECT {columns}, {reached}, {counts}, sum(revenue) AS revenue "
                    f"FROM steps GROUP BY {columns} ORDER BY {order}"
                ),
                params,
            )
        )
        for row in rows:
            row["revenue"] = int(row["revenue"] or 0)
        return rows

    by_source = await grouped("source", "visit DESC, source")
    by_country = await grouped("country", "visit DESC, country")
    by_campaign = await grouped("campaign, content", "campaign = '', visit DESC, campaign, content")
    total = {step: sum(row[step] for row in by_source) for step in FUNNEL_STEPS}
    total["revenue"] = sum(row["revenue"] for row in by_source)

    # Payments in the period by the payer's first source: also those made days after the visit.
    attributed = _rows(
        await session.execute(
            text(
                f"""
                SELECT coalesce(u.src_campaign, '') AS campaign, coalesce(u.src_content, '') AS content,
                       coalesce(u.src_country, '') AS country, count(*) AS paid, sum(p.amount) AS revenue
                FROM payments p JOIN users u ON u.id = p.user_id
                WHERE p.status = 'paid' {"" if tests else "AND NOT u.is_test"}
                  AND (p.paid_at AT TIME ZONE :tz)::date >= :start AND (p.paid_at AT TIME ZONE :tz)::date < :end
                  AND (:country = '' OR u.src_country = :country)
                GROUP BY 1, 2, 3
                """
            ),
            params,
        )
    )
    for rows, keys in ((by_campaign, ("campaign", "content")), (by_country, ("country",))):
        sums: dict[tuple, list[int]] = {}
        for a in attributed:
            acc = sums.setdefault(tuple(a[k] for k in keys), [0, 0])
            acc[0] += a["paid"]
            acc[1] += int(a["revenue"] or 0)
        seen = set()
        for row in rows:
            k = tuple(row[x] for x in keys)
            seen.add(k)
            row["paid_by_source"], row["revenue_by_source"] = sums.get(k, [0, 0])
        for k, (paid_n, revenue) in sums.items():
            if k not in seen:  # paid now, came in before this period
                rows.append({**dict(zip(keys, k)), **{s: 0 for s in FUNNEL_STEPS}, "revenue": 0,
                             "paid_by_source": paid_n, "revenue_by_source": revenue})

    by_series = _rows(
        await session.execute(
            text(
                f"""
                WITH v AS (
                  SELECT (at AT TIME ZONE :tz)::date AS d, visitor, event, country,
                    CASE WHEN event = '' THEN split_part(path, '/', 3) ELSE split_part(target, '/', 1) END AS slug
                  FROM {V}
                  WHERE (at AT TIME ZONE :tz)::date >= :start AND (at AT TIME ZONE :tz)::date < :end
                    AND (event IN ('cover', 'episode', 'paywall') OR (event = '' AND path LIKE '/series/%'))
                    AND (:country = '' OR country = :country)
                )
                SELECT slug,
                  count(DISTINCT (d, visitor)) FILTER (WHERE event = 'cover') AS cover,
                  count(DISTINCT (d, visitor)) FILTER (WHERE event = '') AS series,
                  count(DISTINCT (d, visitor)) FILTER (WHERE event = 'episode') AS episode,
                  count(DISTINCT (d, visitor)) FILTER (WHERE event = 'paywall') AS paywall
                FROM v WHERE slug <> '' GROUP BY slug ORDER BY cover DESC, series DESC, slug
                """
            ),
            params,
        )
    )
    # Straight from the tables, not tied to visits: the counter can miss people (blockers).
    server = (
        await session.execute(
            text(
                f"""
                SELECT
                  (SELECT count(*) FROM users WHERE {"" if tests else "NOT is_test AND "}(created_at AT TIME ZONE :tz)::date >= :start
                     AND (created_at AT TIME ZONE :tz)::date < :end) AS signups,
                  (SELECT count(*) FROM payments WHERE (created_at AT TIME ZONE :tz)::date >= :start{U}
                     AND (created_at AT TIME ZONE :tz)::date < :end) AS checkouts,
                  (SELECT count(*) FROM payments WHERE status = 'paid'{U} AND (paid_at AT TIME ZONE :tz)::date >= :start
                     AND (paid_at AT TIME ZONE :tz)::date < :end) AS paid,
                  (SELECT coalesce(sum(amount), 0) FROM payments WHERE status = 'paid'{U}
                     AND (paid_at AT TIME ZONE :tz)::date >= :start AND (paid_at AT TIME ZONE :tz)::date < :end) AS revenue
                """
            ),
            params,
        )
    ).one()
    countries = [
        r[0]
        for r in (
            await session.execute(
                text(f"SELECT DISTINCT country FROM {V} WHERE country <> '' AND (at AT TIME ZONE :tz)::date >= :start ORDER BY 1"),
                params,
            )
        ).all()
    ]

    return {
        "timezone": TZ_NAME,
        "period": period if period in PERIODS else "7d",
        "country": country,
        "countries": countries,
        "tests": tests,
        "steps": FUNNEL_STEPS,
        "total": total,
        "by_source": by_source,
        "by_country": by_country,
        "by_campaign": by_campaign,
        "by_series": by_series,
        "server": {**dict(server._mapping), "revenue": int(server.revenue)},
    }


@router.get("/series-views")
async def series_views(session: Session) -> dict:
    """Real plays for the showcase (instead of made-up counters): episode opens per series and
    per episode, all time, without test accounts."""
    rows = (
        await session.execute(
            text(
                f"SELECT target, count(*) AS n FROM {LIVE_VISITS} WHERE event = 'episode' AND target LIKE '%/%' GROUP BY target"
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
