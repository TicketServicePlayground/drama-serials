"""Makes the lighter 480p copy of every episode video that has none yet.

Copies go to <media_prefix minus the slash>-480/<same path> (see app.media.sd_key); the API's
scanner notices them within MEDIA_SCAN_SECONDS and the player starts offering "480p".
Early episodes first: they are watched the most. Safe to stop and run again.

On the server, beside the site, at low priority:
    docker run -d --rm --name drama-sd --cpus 2 --env-file /opt/drama-serials/.env \
        drama-serials-api nice -n 19 python -m scripts.make_sd
"""

import argparse
import logging
import os
import re
import subprocess
import tempfile

from app import media
from app.config import settings

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")
logger = logging.getLogger("make_sd")

EPISODE = re.compile(r"/(\d{1,3})\.(mp4|webm|m4v)$")


def encode(source_url: str, target: str, threads: int) -> None:
    subprocess.run(
        [
            "ffmpeg", "-v", "error", "-y", "-i", source_url,
            "-map", "0:v:0", "-map", "0:a:0?",
            # The short side becomes 480, vertical or not.
            "-vf", "scale='if(gt(iw,ih),-2,480)':'if(gt(iw,ih),480,-2)'",
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "26",
            "-maxrate", "900k", "-bufsize", "1800k", "-profile:v", "main", "-pix_fmt", "yuv420p",
            "-c:a", "aac", "-b:a", "96k", "-ac", "2",
            "-movflags", "+faststart", "-threads", str(threads),
            target,
        ],
        check=True,
        timeout=1800,
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=0, help="stop after this many copies")
    parser.add_argument("--threads", type=int, default=2)
    args = parser.parse_args()

    originals = [o for o in media._list_videos() if media._video_key().match(o["Key"])]
    done = {o["Key"] for o in media._list_videos(media.sd_prefix())}
    todo = [o for o in originals if media.sd_key(o["Key"]) not in done]
    todo.sort(key=lambda o: (int(EPISODE.search(o["Key"]).group(1)), o["Key"]))
    logger.info("%d originals, %d copies exist, %d to make", len(originals), len(done), len(todo))

    made = saved = 0
    for obj in todo:
        key, target_key = obj["Key"], media.sd_key(obj["Key"])
        with tempfile.TemporaryDirectory() as tmp:
            target = os.path.join(tmp, "sd.mp4")
            try:
                encode(media.signed_url(key, ttl=3600), target, args.threads)
            except (subprocess.CalledProcessError, subprocess.TimeoutExpired) as exc:
                logger.warning("skip %s: %s", key, exc)
                continue
            size = os.path.getsize(target)
            media._s3().upload_file(
                target, settings.media_bucket, target_key, ExtraArgs={"ContentType": "video/mp4"}
            )
        made += 1
        saved += obj["Size"] - size
        logger.info(
            "%d/%d %s: %.1f → %.1f MB", made, len(todo), key, obj["Size"] / 1e6, size / 1e6
        )
        if args.limit and made >= args.limit:
            break
    logger.info("done: %d copies, %.1f GB lighter than the originals", made, saved / 1e9)


if __name__ == "__main__":
    main()
