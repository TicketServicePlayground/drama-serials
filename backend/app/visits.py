"""The site's own visit counter: page views in, counts and the raw rows out for the team.

No cookies and no raw IPs are kept. Each row keeps the browser's random id (client_id), which is
what people are counted by, and a daily HMAC(secret, day + IP + browser) (visitor), which is
stored only, never used to merge anyone.
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
CLIENT_ID_RE = re.compile(r"^[a-f0-9]{16,32}$")
# The stats are raw: every visit, sign-up and payment counts, whoever made it. Nothing here
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
        if not user.ab and visit.ab:
            user.ab = visit.ab
    await session.commit()
    return None


async def link_browser(session, user, cid: str) -> None:
    """The browser a payment is made from is the payer's: its visits so far get their user id.
    Someone who signs up at paying and goes straight to the payment page sends no signed-in page
    view, so without this their payment would belong to no browser. Only this exact browser id."""
    if not CLIENT_ID_RE.match(cid):
        return
    await session.execute(
        text("UPDATE visits SET user_id = :user WHERE client_id = :cid AND user_id IS NULL"),
        {"user": user.id, "cid": cid},
    )


# --- how the numbers are counted --------------------------------------------------------------
#
# No guessing, no merging of people by IP or browser model:
#   - a browser is visits.client_id, the random id the browser keeps (lib/track.ts);
#     rows without one (storage blocked) are counted as rows, never as people;
#   - a browser's source / campaign / ad / country / A/B group is the first non-empty value in
#     its rows, ever; a row without a browser id has its own;
#   - a sign-up and a payment belong to the user's browser: the first one the user was signed in
#     on (visits.user_id); a user never seen on a browser has no source;
#   - days are Bali days (WITA); sign-ups by users.created_at, started payments by
#     payments.created_at, paid ones by payments.paid_at.

LABELS = ("source", "campaign", "content", "country", "ab")
# Browser labels and each user's browser, over all time.
LABELED = """
    bl AS (
      SELECT client_id,
        coalesce((array_agg(utm_source ORDER BY at) FILTER (WHERE utm_source <> ''))[1],
                 (array_agg(referrer ORDER BY at) FILTER (WHERE referrer <> ''))[1], '') AS source,
        coalesce((array_agg(utm_campaign ORDER BY at) FILTER (WHERE utm_campaign <> ''))[1], '') AS campaign,
        coalesce((array_agg(utm_content ORDER BY at) FILTER (WHERE utm_content <> ''))[1], '') AS content,
        coalesce((array_agg(country ORDER BY at) FILTER (WHERE country <> ''))[1], '') AS country,
        coalesce((array_agg(ab ORDER BY at) FILTER (WHERE ab <> ''))[1], '') AS ab
      FROM visits WHERE client_id <> '' GROUP BY client_id
    ), ub AS (
      SELECT DISTINCT ON (user_id) user_id, client_id FROM visits
      WHERE user_id IS NOT NULL AND client_id <> '' ORDER BY user_id, at
    ), ul AS (
      SELECT u.id AS user_id, coalesce(bl.source, '') AS source, coalesce(bl.campaign, '') AS campaign,
        coalesce(bl.content, '') AS content, coalesce(bl.country, '') AS country, coalesce(bl.ab, '') AS ab
      FROM users u LEFT JOIN ub ON ub.user_id = u.id LEFT JOIN bl ON bl.client_id = ub.client_id
    )
"""
DAY = "(at AT TIME ZONE :tz)::date"
IN_PERIOD = "({col} AT TIME ZONE :tz)::date >= :start AND ({col} AT TIME ZONE :tz)::date < :end"

# Steps of the funnel. From visits rows: `step` = browsers (distinct client_id), `step_rows` = rows.
# From the tables: `signup` = users, `checkout` = payments started, `paid` = payments paid.
VISIT_STEPS = ["visit", "cover", "auth_open", "series", "episode", "email_gate", "paywall"]
TABLE_STEPS = ["signup", "checkout", "paid"]
FUNNEL_STEPS = ["visit", "cover", "auth_open", "signup", "series", "episode", "email_gate", "paywall", "checkout", "paid"]
PERIODS = {"today": (0, -1), "yesterday": (1, 0), "7d": (6, -1), "30d": (29, -1)}


def _rows(result) -> list[dict]:
    return [dict(row._mapping) for row in result]


def _facts() -> str:
    """One row per counted thing in the period: kind, browser id ('' = none), amount, labels."""
    own = ", ".join(
        f"CASE WHEN bl.client_id IS NULL THEN {expr} ELSE bl.{name} END AS {name}"
        for name, expr in (
            ("source", "coalesce(nullif(v.utm_source, ''), v.referrer)"),
            ("campaign", "v.utm_campaign"),
            ("content", "v.utm_content"),
            ("country", "v.country"),
            ("ab", "v.ab"),
        )
    )
    labels = ", ".join(f"ul.{n}" for n in LABELS)
    return f"""
        WITH {LABELED}, ev AS (
          SELECT v.event, v.path, v.target, v.client_id, {own}
          FROM visits v LEFT JOIN bl ON bl.client_id = v.client_id AND v.client_id <> ''
          WHERE {IN_PERIOD.format(col="v.at")}
        ), facts AS (
          SELECT CASE WHEN event = '' THEN 'visit' ELSE event END AS kind, client_id, 0 AS amount, {", ".join(LABELS)} FROM ev
          UNION ALL
          SELECT 'series', client_id, 0, {", ".join(LABELS)} FROM ev WHERE event = '' AND path LIKE '/series/%'
          UNION ALL
          SELECT 'signup', '', 0, {labels} FROM users u JOIN ul ON ul.user_id = u.id WHERE {IN_PERIOD.format(col="u.created_at")}
          UNION ALL
          SELECT 'emails', '', 0, {labels} FROM users u JOIN ul ON ul.user_id = u.id WHERE {IN_PERIOD.format(col="u.email_gate_at")}
          UNION ALL
          SELECT 'checkout', '', p.amount, {labels} FROM payments p JOIN ul ON ul.user_id = p.user_id WHERE {IN_PERIOD.format(col="p.created_at")}
          UNION ALL
          SELECT 'paid', '', p.amount, {labels} FROM payments p JOIN ul ON ul.user_id = p.user_id
          WHERE p.status = 'paid' AND {IN_PERIOD.format(col="p.paid_at")}
        )
    """


def _counts() -> str:
    parts = []
    for step in VISIT_STEPS:
        parts.append(f"count(DISTINCT client_id) FILTER (WHERE kind = '{step}' AND client_id <> '') AS {step}")
        parts.append(f"count(*) FILTER (WHERE kind = '{step}') AS {step}_rows")
    parts.append("count(*) FILTER (WHERE kind = 'visit' AND client_id = '') AS visit_no_id")
    for step in TABLE_STEPS + ["emails"]:
        parts.append(f"count(*) FILTER (WHERE kind = '{step}') AS {step}")
    parts.append("coalesce(sum(amount) FILTER (WHERE kind = 'paid'), 0) AS revenue")
    return ", ".join(parts)


@router.get("/stats")
async def stats(session: Session, key: Annotated[str, Query()] = ""):
    """Page views (rows with event ""), browsers among them, sign-ups and payments, by Bali day.
    A session is a browser's page view after 30 minutes or more without one; a return session
    is any but the browser's first."""
    if not settings.stats_key or not hmac.compare_digest(key, settings.stats_key):
        return JSONResponse({"error": "not_found"}, status_code=404)
    tz = {"tz": TZ_NAME}
    today = datetime.now(TZ).date()

    sessions = {
        row.d: (row.sessions, row.returns)
        for row in (
            await session.execute(
                text(
                    f"""
                    WITH s AS (
                      SELECT at, lag(at) OVER (PARTITION BY client_id ORDER BY at) AS prev
                      FROM visits WHERE event = '' AND client_id <> ''
                    )
                    SELECT {DAY} AS d,
                      count(*) FILTER (WHERE prev IS NULL OR at - prev >= interval '30 minutes') AS sessions,
                      count(*) FILTER (WHERE prev IS NOT NULL AND at - prev >= interval '30 minutes') AS returns
                    FROM s WHERE {DAY} >= :start GROUP BY 1
                    """
                ),
                {**tz, "start": today - timedelta(days=29)},
            )
        ).all()
    }

    async def totals(since_days: int, until_days: int = -1) -> dict:
        start, end = today - timedelta(days=since_days), today - timedelta(days=until_days)
        params = {**tz, "start": start, "end": end}
        views = (
            await session.execute(
                text(
                    "SELECT count(*) AS views, count(DISTINCT nullif(client_id, '')) AS browsers, "
                    "count(*) FILTER (WHERE client_id = '') AS views_no_id, "
                    "count(*) FILTER (WHERE user_id IS NOT NULL) AS signed_in_views "
                    f"FROM visits WHERE event = '' AND {IN_PERIOD.format(col='at')}"
                ),
                params,
            )
        ).one()
        tables = (
            await session.execute(
                text(
                    f"SELECT (SELECT count(*) FROM users WHERE {IN_PERIOD.format(col='created_at')}) AS signups, "
                    f"(SELECT count(*) FROM payments WHERE status = 'paid' AND {IN_PERIOD.format(col='paid_at')}) AS paid, "
                    f"(SELECT coalesce(sum(amount), 0) FROM payments WHERE status = 'paid' AND {IN_PERIOD.format(col='paid_at')}) AS revenue"
                ),
                params,
            )
        ).one()
        days = [v for d, v in sessions.items() if start <= d < end]
        return {
            **dict(views._mapping),
            "signups": tables.signups,
            "paid": tables.paid,
            "revenue": int(tables.revenue),
            "sessions": sum(v[0] for v in days),
            "returns": sum(v[1] for v in days),
        }

    week = {**tz, "start": today - timedelta(days=6), "end": today + timedelta(days=1)}

    async def top(column: str, limit: int = 10) -> list[dict]:
        return _rows(
            await session.execute(
                text(
                    f"SELECT {column} AS name, count(*) AS views, count(DISTINCT nullif(client_id, '')) AS browsers "
                    f"FROM visits WHERE event = '' AND {IN_PERIOD.format(col='at')} AND {column} <> '' "
                    f"GROUP BY {column} ORDER BY views DESC LIMIT {limit}"
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
                  (SELECT count(DISTINCT nullif(client_id, '')) FROM visits WHERE event = '' AND {DAY} = days.d) AS browsers,
                  (SELECT count(*) FROM visits WHERE event = '' AND {DAY} = days.d) AS views,
                  (SELECT count(*) FROM visits WHERE event = '' AND client_id = '' AND {DAY} = days.d) AS views_no_id,
                  (SELECT count(*) FROM users WHERE (created_at AT TIME ZONE :tz)::date = days.d) AS signups,
                  (SELECT count(*) FROM payments WHERE status = 'paid' AND (paid_at AT TIME ZONE :tz)::date = days.d) AS paid
                FROM days ORDER BY days.d DESC
                """
            ),
            {**tz, "start": today - timedelta(days=13), "today": today},
        )
    )
    for row in by_day:
        row["sessions"], row["returns"] = sessions.get(row["day"], (0, 0))
        row["day"] = row["day"].isoformat()
    recent = _rows(
        await session.execute(
            text(
                "SELECT at, client_id, path, referrer, utm_source, lang, device, country, "
                "(user_id IS NOT NULL) AS signed_in FROM visits WHERE event = '' ORDER BY at DESC LIMIT 50"
            )
        )
    )
    for row in recent:
        row["at"] = row["at"].isoformat()

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


@router.get("/funnel")
async def funnel(
    session: Session,
    key: Annotated[str, Query()] = "",
    period: Annotated[str, Query()] = "7d",
    country: Annotated[str, Query()] = "",
):
    """Counts of each step in the period, whole and by source, country, campaign, A/B group and
    series; how they are counted is above (`how the numbers are counted`)."""
    if not settings.stats_key or not hmac.compare_digest(key, settings.stats_key):
        return JSONResponse({"error": "not_found"}, status_code=404)
    since, until = PERIODS.get(period, PERIODS["7d"])
    today = datetime.now(TZ).date()
    country = country.strip().upper() if COUNTRY_RE.match(country.strip().upper()) else ""
    params = {"tz": TZ_NAME, "start": today - timedelta(days=since), "end": today - timedelta(days=until), "country": country}
    facts = _facts()
    where = "WHERE (:country = '' OR country = :country)"

    async def grouped(columns: str) -> list[dict]:
        rows = _rows(
            await session.execute(
                text(f"{facts} SELECT {columns}, {_counts()} FROM facts {where} GROUP BY {columns} ORDER BY visit_rows DESC, {columns}"),
                params,
            )
        )
        for row in rows:
            row["revenue"] = int(row["revenue"])
        return rows

    by_source = await grouped("source")
    total = {k: sum(r[k] for r in by_source) for k in by_source[0] if k != "source"} if by_source else {}
    series = _rows(
        await session.execute(
            text(
                f"""{facts}, s AS (
                  SELECT kind, client_id,
                    CASE WHEN kind IN ('visit', 'series') THEN split_part(path, '/', 3) ELSE split_part(target, '/', 1) END AS slug
                  FROM (SELECT CASE WHEN event = '' THEN 'series' ELSE event END AS kind, client_id, path, target, country
                        FROM ev WHERE event IN ('cover', 'episode', 'paywall') OR (event = '' AND path LIKE '/series/%')) e
                  {where}
                )
                SELECT slug,
                  {", ".join(f"count(DISTINCT nullif(client_id, '')) FILTER (WHERE kind = '{k}') AS {k}, count(*) FILTER (WHERE kind = '{k}') AS {k}_rows" for k in ("cover", "series", "episode", "paywall"))}
                FROM s WHERE slug <> '' GROUP BY slug ORDER BY cover_rows DESC, series_rows DESC, slug
                """
            ),
            params,
        )
    )
    countries = [r[0] for r in (await session.execute(text(f"{facts} SELECT DISTINCT country FROM facts WHERE country <> '' ORDER BY 1"), params)).all()]
    return {
        "timezone": TZ_NAME,
        "period": period if period in PERIODS else "7d",
        "country": country,
        "countries": countries,
        "steps": FUNNEL_STEPS,
        "visit_steps": VISIT_STEPS,
        "total": total,
        "by_source": by_source,
        "by_country": await grouped("country"),
        "by_campaign": await grouped("campaign, content"),
        "by_ab": [r for r in await grouped("ab") if r["ab"]],
        "by_series": series,
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


# --- raw data for the team ---------------------------------------------------------------------

# Tables as they are in the database, every column but password hashes. No counting, no merging:
# the team counts by itself. Days and times are Bali time (WITA, +08:00).
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
        return value.astimezone(TZ).isoformat()
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
    """Rows of one table, newest first, for the Bali days [from, to] (default: the last 7).
    JSON comes a page at a time; format=csv is the whole period in one file."""
    if not settings.stats_key or not hmac.compare_digest(key, settings.stats_key):
        return JSONResponse({"error": "not_found"}, status_code=404)
    if table not in RAW_TABLES:
        return JSONResponse({"error": "unknown_table"}, status_code=400)
    today = datetime.now(TZ).date()
    end = end or today
    start = start or end - timedelta(days=6)
    column = RAW_TABLES[table]
    # Table and column names come from RAW_TABLES only, never from the request.
    where = f"{column} >= :start AND {column} < :end"
    params = {
        "start": datetime.combine(start, datetime.min.time(), TZ),
        "end": datetime.combine(end + timedelta(days=1), datetime.min.time(), TZ),
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
