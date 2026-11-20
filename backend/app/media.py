"""Episode videos in a private R2 bucket.

Uploads follow <media_prefix><series-slug>/[<lang>/]<episode-number>.<mp4|webm>: the optional
<lang> folder holds a dubbed cut (scripts/import-sheet.mjs copies them there). A scanner lists the bucket,
reads each new or changed file's duration with ffprobe (headers only, through a signed URL)
and records it in episode_media. Viewers with access get a signed URL that expires.

Lighter 480p copies (backend/scripts/make_sd.py) mirror that layout under <media_prefix minus
the slash>-480/, e.g. video/ → video-480/; the player offers them as a lower quality.
"""

import asyncio
import logging
import re
from datetime import UTC, datetime

import boto3
from botocore.config import Config
from sqlalchemy import select

from app.config import settings
from app.db import SessionLocal
from app.models import EpisodeMedia

logger = logging.getLogger(__name__)


def _video_key() -> re.Pattern[str]:
    return re.compile(
        "^"
        + re.escape(settings.media_prefix)
        + r"([a-z0-9-]{1,80})/(?:([a-z]{2})/)?(\d{1,3})\.(mp4|webm|m4v)$"
    )


_client = None


def _s3():
    global _client
    if _client is None:
        _client = boto3.client(
            "s3",
            endpoint_url=f"https://{settings.media_r2_account_id}.r2.cloudflarestorage.com",
            aws_access_key_id=settings.media_r2_access_key_id,
            aws_secret_access_key=settings.media_r2_secret_access_key,
            region_name="auto",
            config=Config(signature_version="s3v4", retries={"max_attempts": 3}),
        )
    return _client


def signed_url(key: str, ttl: int | None = None) -> str:
    return _s3().generate_presigned_url(
        "get_object",
        Params={"Bucket": settings.media_bucket, "Key": key},
        ExpiresIn=ttl or settings.play_url_ttl_seconds,
    )


def sd_prefix() -> str:
    return settings.media_prefix.rstrip("/") + "-480/"


def sd_key(key: str) -> str:
    """Where the 480p copy of an original video lives."""
    return sd_prefix() + key.removeprefix(settings.media_prefix)


# Keys of the 480p copies found by the last scan.
_sd_keys: set[str] = set()


def has_sd(key: str) -> bool:
    return sd_key(key) in _sd_keys


def _list_videos(prefix: str | None = None) -> list[dict]:
    found, token = [], None
    while True:
        kwargs = {"Bucket": settings.media_bucket, "Prefix": prefix or settings.media_prefix}
        if token:
            kwargs["ContinuationToken"] = token
        page = _s3().list_objects_v2(**kwargs)
        found += page.get("Contents", [])
        if not page.get("IsTruncated"):
            return found
        token = page["NextContinuationToken"]


async def probe_duration(key: str) -> int | None:
    process = await asyncio.create_subprocess_exec(
        "ffprobe",
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "csv=p=0",
        signed_url(key, ttl=600),
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    try:
        out, err = await asyncio.wait_for(process.communicate(), timeout=60)
    except TimeoutError:
        process.kill()
        return None
    try:
        return round(float(out.decode().strip()))
    except ValueError:
        logger.warning("ffprobe could not read %s: %s", key, err.decode()[:200])
        return None


async def scan_once() -> int:
    """Brings episode_media in line with the bucket. Returns how many files were (re)read."""
    if not settings.media_enabled:
        return 0
    objects = await asyncio.to_thread(_list_videos)
    global _sd_keys
    _sd_keys = {obj["Key"] for obj in await asyncio.to_thread(_list_videos, sd_prefix())}
    changed = 0
    async with SessionLocal() as session:
        known = {
            (m.slug, m.episode, m.lang): m
            for m in (await session.scalars(select(EpisodeMedia))).all()
        }
        seen = set()
        pattern = _video_key()
        for obj in objects:
            match = pattern.match(obj["Key"])
            if not match:
                continue
            slug, lang, episode = match.group(1), match.group(2) or "", int(match.group(3))
            seen.add((slug, episode, lang))
            etag = obj["ETag"].strip('"')
            row = known.get((slug, episode, lang))
            if row and row.etag == etag and row.duration_seconds is not None:
                continue
            duration = await probe_duration(obj["Key"])
            if row is None:
                row = EpisodeMedia(slug=slug, episode=episode, lang=lang)
                session.add(row)
            row.object_key, row.etag, row.size_bytes = obj["Key"], etag, obj["Size"]
            row.duration_seconds = duration
            row.updated_at = datetime.now(UTC)
            changed += 1
            logger.info("episode video %s/%s/%s: %ss", slug, lang or "-", episode, duration)
        for key, row in known.items():
            if key not in seen:
                await session.delete(row)
        await session.commit()
    return changed


def pick_cut(cuts: list[EpisodeMedia], lang: str | None) -> EpisodeMedia | None:
    """The viewer's language, then a language-neutral file, then Indonesian, English, anything."""
    by_lang = {c.lang: c for c in cuts}
    for choice in (lang, "", "id", "en"):
        if choice is not None and choice in by_lang:
            return by_lang[choice]
    return min(cuts, key=lambda c: c.lang) if cuts else None


async def run_forever() -> None:
    while True:
        try:
            await scan_once()
        except Exception:  # noqa: BLE001 — keep scanning after a bad file or network blip
            logger.exception("media scan failed")
        await asyncio.sleep(settings.media_scan_seconds)
