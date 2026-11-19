#!/usr/bin/env bash
# Runs on the server from cron (/etc/cron.d/drama-serials-sync) every 10 minutes:
# when the content team's Google Sheet changed, imports it (scripts/import-sheet.mjs),
# publishes the images, rebuilds and restarts the site, and reports to Telegram.
#
# The server copy of the source tree (/opt/drama-serials/build) holds the content of record:
# lib/catalog.json, lib/images.json, assets/, public/og/. deploy.sh does not overwrite them
# (unless --push-content); scripts/pull-content.sh brings them to a laptop.
#
# Usage: scripts/sync-sheet.sh [--force]   (--force: run even if the sheet did not change)
set -euo pipefail

ROOT=/opt/drama-serials
SRC=$ROOT/build
STATE=$ROOT/sync
SHEET_ID=${SHEET_ID:-1qEIFe4_hlbBFAo-KhU8gYLrXByklhrWKXtxlmWZXCao}
TOOLS=drama-serials-tools:latest

mkdir -p "$STATE"
exec 9>"$STATE/lock"
flock -n 9 || exit 0
cd "$SRC"

env_of() { grep -E "^$1=" "$ROOT/.env" | head -1 | cut -d= -f2- || true; }

telegram() {
  local token chat
  token=$(env_of TELEGRAM_BOT_TOKEN)
  chat=$(env_of TELEGRAM_CHAT_ID)
  [ -n "$token" ] && [ -n "$chat" ] || return 0
  curl -fsS -m 20 "https://api.telegram.org/bot$token/sendMessage" \
    --data-urlencode "chat_id=$chat" --data-urlencode "text=$1" \
    -d disable_web_page_preview=true >/dev/null || true
}

fail() {
  # One message per sheet version: the next run stays quiet until the sheet changes again.
  echo "$sheet_sha" > "$STATE/failed.sha"
  telegram "AN Serials: таблица не выложилась на сайт ($1).
$(tail -n 8 "$STATE/last.log" 2>/dev/null)"
  exit 1
}

log() { echo "$(date -u +%FT%TZ) $*"; }

curl -fsSL -m 60 "https://docs.google.com/spreadsheets/d/$SHEET_ID/export?format=csv" -o "$STATE/sheet.csv.new"
sheet_sha=$(sha256sum "$STATE/sheet.csv.new" | cut -d' ' -f1)
if [ "${1:-}" != "--force" ]; then
  [ "$sheet_sha" = "$(cat "$STATE/sheet.sha" 2>/dev/null)" ] && exit 0
  [ "$sheet_sha" = "$(cat "$STATE/failed.sha" 2>/dev/null)" ] && exit 0
fi
log "sheet changed, importing"

# The daily `docker image prune` removes the tools image when idle; rebuild it then.
docker image inspect "$TOOLS" >/dev/null 2>&1 \
  || docker build -q -f Dockerfile.tools -t "$TOOLS" . >"$STATE/last.log" 2>&1 \
  || fail "не собрался образ для импорта"

content_sha() { cat lib/catalog.json lib/images.json | sha256sum | cut -d' ' -f1; }
before=$(content_sha)
cp lib/catalog.json "$STATE/catalog.prev.json"

docker run --rm -v "$SRC:/src" -v "$STATE:/state" \
  -e R2_ACCOUNT_ID="$(env_of MEDIA_R2_ACCOUNT_ID)" \
  -e R2_ACCESS_KEY_ID="$(env_of MEDIA_R2_ACCESS_KEY_ID)" \
  -e R2_SECRET_ACCESS_KEY="$(env_of MEDIA_R2_SECRET_ACCESS_KEY)" \
  -e SHEET_ID="$SHEET_ID" \
  "$TOOLS" sh -c "node scripts/import-sheet.mjs && node scripts/publish-images.mjs && node scripts/og-images.mjs" \
  >"$STATE/last.log" 2>&1 || fail "ошибка импорта"

if [ "$before" = "$(content_sha)" ]; then
  log "nothing new for the site"
  echo "$sheet_sha" > "$STATE/sheet.sha"
  exit 0
fi

summary=$(docker run --rm -v "$SRC:/src" -v "$STATE:/state" "$TOOLS" node scripts/catalog-diff.mjs /state/catalog.prev.json lib/catalog.json)
warnings=$(grep '^! ' "$STATE/last.log" | grep -v 'new series —' | head -n 10 || true)

built=""
for attempt in 1 2 3; do
  if nice -n 10 docker build -q -t drama-serials:latest . >>"$STATE/last.log" 2>&1; then built=1; break; fi
  log "web build failed ($attempt)"
done
[ -n "$built" ] || fail "сайт не собрался"
(cd "$ROOT" && docker compose up -d web) >>"$STATE/last.log" 2>&1 || fail "сайт не перезапустился"

echo "$sheet_sha" > "$STATE/sheet.sha"
rm -f "$STATE/failed.sha"
log "deployed: $summary"
telegram "AN Serials: на сайт выложено из таблицы
$summary${warnings:+

Проверить:
$warnings}"
