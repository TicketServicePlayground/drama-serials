#!/usr/bin/env bash
# Ships the code to the server, builds the site and API images there and restarts.
#
# The server's copy of the content (lib/catalog.json, lib/images.json, assets/, public/og/)
# is the one of record: scripts/sync-sheet.sh keeps it in step with the content sheet. So the
# code goes up without it, unless --push-content is given (after editing the catalog by hand;
# fetch the current one first with scripts/pull-content.sh).
#
# Usage: ./deploy.sh [--push-content]
set -euo pipefail

SERVER="${SERVER:-root@168.231.121.10}"
REMOTE_DIR=/opt/drama-serials

cd "$(dirname "$0")"

CONTENT=(--exclude /lib/catalog.json --exclude /lib/images.json --exclude /assets/ --exclude /public/og/)
[ "${1:-}" = "--push-content" ] && CONTENT=()

rsync -az --delete \
  --exclude node_modules --exclude .next --exclude .git --exclude /data --exclude .env \
  --exclude '*.tar' --exclude '*.tar.gz' --exclude .venv --exclude __pycache__ --exclude .pytest_cache \
  ${CONTENT[@]+"${CONTENT[@]}"} ./ "$SERVER:$REMOTE_DIR/build/"

ssh "$SERVER" "set -e; cd $REMOTE_DIR
  cp build/docker-compose.yml build/.env.example .
  mkdir -p sync
  install -m 644 build/scripts/drama-serials-sync.cron /etc/cron.d/drama-serials-sync
  umask 077; touch .env
  # Generated once and then kept: sessions and the database survive redeploys.
  grep -q '^DB_PASSWORD=.' .env || echo \"DB_PASSWORD=\$(openssl rand -hex 24)\" >> .env
  grep -q '^JWT_SECRET=.' .env || echo \"JWT_SECRET=\$(openssl rand -hex 32)\" >> .env
  grep -q '^STATS_KEY=.' .env || echo \"STATS_KEY=\$(openssl rand -hex 12)\" >> .env
  cd build
  # next/font fetches Google Fonts during the build and now and then fails: retry.
  for i in 1 2 3; do nice -n 10 docker build -q -t drama-serials:latest . && break; [ \$i = 3 ] && exit 1; done
  # An empty DOCKER_CONFIG: stale registry logins on the server make ghcr.io refuse anonymous pulls.
  anon=\$(mktemp -d); DOCKER_CONFIG=\$anon nice -n 10 docker build -q -t drama-serials-api:latest backend; rm -rf \$anon
  cd ..
  docker compose up -d --remove-orphans
  docker compose ps"
