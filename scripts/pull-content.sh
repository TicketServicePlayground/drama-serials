#!/usr/bin/env bash
# Brings the server's content (kept current from the sheet by scripts/sync-sheet.sh) to this
# copy: lib/catalog.json, lib/images.json, assets/, public/og/. Run before editing the catalog
# by hand, then ./deploy.sh --push-content.
set -euo pipefail
SERVER="${SERVER:-root@168.231.121.10}"
cd "$(dirname "$0")/.."
rsync -az "$SERVER:/opt/drama-serials/build/lib/catalog.json" "$SERVER:/opt/drama-serials/build/lib/images.json" lib/
rsync -az --delete "$SERVER:/opt/drama-serials/build/assets/" assets/
rsync -az --delete "$SERVER:/opt/drama-serials/build/public/og/" public/og/
echo "content pulled from $SERVER"
