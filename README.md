# drama-serials (AN Serials)

Storefront for short drama series: covers → sign up (email + password, no confirmation)
→ series page → 7-day pass for all series (Rp 9.900) paid by QRIS or card → episodes open.

```
nginx (affinet.link) → web  Next.js 16, 127.0.0.1:3010
                         └→ api  FastAPI (backend/), docker network only
                              ├→ db  Postgres 16 (volume drama-serials-pg)
                              ├→ Xendit invoices (QRIS)      ┐ Eventstripe's live accounts,
                              ├→ DOKU Checkout (cards)       ┘ money to the main accounts
                              └→ Eventstripe DB, read-only role drama_ro:
                                 payment_events (provider notifications)
```

- Next.js 16 (App Router, standalone) + HeroUI v3 + Tailwind 4, dark only.
- Languages: `en` (default), `id`, `es`. `?lang=` wins; without it `proxy.ts`
  picks from `Accept-Language`. Strings live in `lib/i18n.ts`, series texts in `lib/catalog.json`.
- Views and like counts are demo numbers from `lib/catalog.json`. Liking requires an account;
  a signed-out tap opens the sign-up dialog.
- "My List" (bookmarks) works without an account. Favourites and likes are stored in
  the cookies `ds_favs` and `ds_likes`.
- Accounts, payments and access periods live in Postgres behind the Python API (`backend/`).
  The site keeps the API's token in the httpOnly cookie `ds_session`; browsers never call the API.

## Plans, launch price, free episodes

Paywall order (`backend/app/products.py`, every number is an env setting in `docker-compose.yml`):

- one series for a day, Rp 12.800 (`series_day`): every episode of one series for 24 h
  (`access_grants.slug`); the series the viewer is on, or any other picked before paying;
- VIP 7 days / 30 days / 1 year: launch price 29.800 / 79.800 / 449.000 until `LAUNCH_ENDS_AT`
  (the first moment of the regular price), then 129.000 / 349.000 / 1.999.000. The paywall shows
  the regular price crossed out, "−`LAUNCH_DISCOUNT_PERCENT`%" and the end date;
- one episode, Rp 10.000, kept for good (not for VIP series).

Episodes 1..`FREE_EPISODES` (7) of every series play without paying or signing in; the series
page is public, a locked episode asks to sign in, then shows the paywall. Finishing the last
episode without VIP opens the paywall with VIP only. The price is decided on the server when the
payment is opened. (`users.offer_expires_at` is left from the old 3-hour offer, unused.)

## Episode videos and photos

The server reads videos from `MEDIA_BUCKET` under `MEDIA_PREFIX`. While the site is being built
this is `glgroup` (public, `cdn.affinet.link`) with `drama-serials/video/`. For production,
the private `an-serials-media` with `video/` is planned, so that videos cannot be watched by
direct link without paying.

```
<MEDIA_PREFIX><series-slug>/<n>.mp4         episode video: MP4, H.264 + AAC, "faststart"
images/covers/<series-slug>.jpg             cover, 2:3, ≥ 720 px wide (title drawn on it)
images/episodes/<series-slug>/<n>.jpg       episode still, 3:2 or 16:9, ≥ 960 px wide
```

Slugs are those in `lib/catalog.json` (e.g. `contract-bride`), and `n` starts at 1. Every 5 minutes
the API finds new or changed videos, reads their duration with ffprobe and shows it on the
episode. Viewers with access get a signed URL valid for 3 hours. Photos go out with the next
`node scripts/publish-images.mjs --from-media` (webp variants → CDN), followed by `./deploy.sh`.

A dubbed cut goes to `<MEDIA_PREFIX><series-slug>/<lang>/<n>.mp4`; the player asks for the viewer's
language and falls back to a language-neutral file, then `id`, then `en`.

**From the content team's Google Sheet** (current workflow): one row per episode and language
with the video link on cdn.affinet.link, titles, hook, description, preview and cover links.

The server picks it up by itself: cron (`/etc/cron.d/drama-serials-sync`) runs
`scripts/sync-sheet.sh` every 10 minutes. When the sheet changed it runs the three scripts below
in a Node + ffmpeg container (`Dockerfile.tools`), rebuilds and restarts the site if the catalog or
images changed, and posts what was added (and the import's warnings) to the Telegram chat
`TELEGRAM_CHAT_ID`. A failure is reported once per sheet version. A full import takes ~5 minutes
(it reads every video's length). Log: `/opt/drama-serials/sync/`; run now:
`ssh root@168.231.121.10 /opt/drama-serials/build/scripts/sync-sheet.sh --force`.

So the server's copy of the content (`lib/catalog.json`, `lib/images.json`, `assets/`,
`public/og/`) is the one of record. Before editing the catalog by hand, fetch it with
`scripts/pull-content.sh`, then deploy with `./deploy.sh --push-content`. By hand:

```
R2_ACCOUNT_ID=... R2_ACCESS_KEY_ID=... R2_SECRET_ACCESS_KEY=... node scripts/import-sheet.mjs
node scripts/publish-images.mjs && node scripts/og-images.mjs && ./deploy.sh --push-content
```

A new series gets the CDN folder name as its slug, and the sheet has no series synopsis and no
Spanish: add those to the catalog by hand (the site falls back to English meanwhile).

It updates `lib/catalog.json` (series matched by the video's CDN folder, `source`), copies the
videos to the layout above, and saves the preview and per-language covers to `assets/`. Languages
missing from the sheet (EN/ES so far) keep the texts already in the catalog.

Upload with any S3 client (endpoint `https://<account-id>.r2.cloudflarestorage.com`, region `auto`):
`aws s3 cp ep1.mp4 s3://an-serials-media/video/contract-bride/1.mp4 --endpoint-url …`, or
rclone or Cyberduck.

## Visit counter

The site counts its own visits, without cookies or third-party services. `components/VisitCounter.tsx`
sends one beacon per page shown to `/api/v`. The site's server adds the IP and User-Agent, and the API
(`backend/app/visits.py`) stores a daily HMAC of them, not the IP. Bot User-Agents are dropped.
The summary (Bali/WITA days, sign-ups and payments alongside) is at `https://affinet.link/stats/<STATS_KEY>`,
the funnel (cover → sign-up → episode → plans → payment, clicks from `lib/track.ts`) at `…/stats/<STATS_KEY>/funnel`:
by country (code from the proxy header `CF-IPCountry` / `X-Country`, the IP is not kept), by campaign → ad
(utm_campaign → utm_content; a payment days later counts for the user's first source, `users.src_*`), by source,
with revenue, a country filter and "показать тестовые". Accounts in `TEST_EMAILS` (and their visitor-days) are
left out by default. Returns from payment pages (doku.com, xendit.co, ixpay-sea.com) are not sources. The
showcase shows real plays (`/api/v1/series-views`) instead of the catalog's numbers.
`STATS_KEY` is in the server `.env`; `deploy.sh` generates it once.

## VIP series and points

- A series is VIP-only when any of its rows in the content sheet has `да`/`yes`/`1`/`✓` in a `VIP`
  column (catalog `vip: true`). It plays only with a pass: the site sends `vip_only=true` to the
  play endpoint and refuses to sell its episodes one by one. Covers and the series page show a VIP badge.
- VIP points (`backend/app/points.py`): a VIP who opens an episode gets `POINTS_DAILY` (50) once per
  Bali day; `POINTS_PER_VIP_DAY` (1000) buy one VIP day in the profile, added after the current access
  (an `access_grants` row with `points_entry_id` instead of `payment_id`).

## Audit logs

- nginx: `/var/log/nginx/affinet.link.access.log` (format `affinet` in `/etc/nginx/conf.d/affinet-log.conf`):
  visitor IP, time, host, request, status, referrer, browser. Rotated daily, 14 days.
- API: `docker logs drama-serials-api | grep audit` — sign-ups, sign-ins (also failed), payments
  opened and episode plays, with user id, email and the visitor's IP (the site's server passes it
  as X-Forwarded-For). Docker keeps 10 × 20 MB.

The stats pages never show IPs.

## Payments

- SBP (Russian speakers only: the button shows on the `ru` locale) goes through IXPAY
  (`backend/app/providers/ixpay.py`, docs https://ixpay-sea.com/docs/public), the Eventstripe business
  unit credited in IDR: a quote for the rupiah price (`calculate?direction=receive`), then a deposit
  bound to its `quote_id`, so the price is credited in full and the payer pays rubles (IXPAY's markup
  on top). The key is live (`pk_live_`); test deposits need a `pk_test_` key. Keys `IXPAY_API_KEY` / `IXPAY_BUSINESS_UNIT_ID` (the same
  unit as novacom-chat); its webhooks go to novacom, so status comes from polling.

- `POST /api/payments {method: QRIS|CREDIT_CARD}` opens the provider's page: QRIS → Xendit
  invoice (`external_id` = `AN-<payment uuid>`), card → DOKU Checkout (`invoice_number` =
  `AN` + 25 base36, the card acquirer allows 30 chars). No split: money stays on the main accounts.
- The payer returns to `/payment/<id>`, which polls until the payment is settled.
- Both accounts are Eventstripe's, so provider notifications go to the Eventstripe backend.
  It acknowledges ours (prefix `AN`) with 200 and records them in `payment_events` as `IGNORED`.
  `backend/app/reconciler.py` reads them from there every 10 s through the read-only role
  `drama_ro` (SELECT on `payment_events` and `xendit_webhook_logs` only).
- A notification is only a signal: the status is always re-read from the provider's API, and
  the amount is checked before access is granted. Every pending payment is also polled every
  60 s, so payments settle even without notifications.
- Access: one `access_grants` row per paid payment (unique), and buying while access is still
  active extends it. Methods on offer: `PAYMENT_METHODS` in `.env`.
- Test locally with `cd backend && uv run pytest`. It needs a Postgres on :5436 (user, password
  and database all `drama`): `docker run -d --name ds-pg-dev -e POSTGRES_USER=drama
  -e POSTGRES_PASSWORD=drama -e POSTGRES_DB=drama -p 127.0.0.1:5436:5432 postgres:16-alpine`.

## Images

Images are served from the CDN, not from `public/`:

1. `scripts/generate-images.mjs` writes source webp files to `assets/covers/<slug>.webp`
   (English title on the poster) and `assets/episodes/<slug>/<n>.webp`. It skips existing
   files unless you pass `--force`.

   ```bash
   IMAGE_PROVIDER=ark ARK_API_KEY=... IMAGE_MODEL=<seedream model id> \
     node scripts/generate-images.mjs [--only covers|episodes] [--match <slug>] [--force]
   ```
   The key and model id are the BytePlus Ark ones from `~/IdeaProjects/ai-video`
   (`note.txt` and `try-01/storks_board/board.py`).

2. `scripts/publish-images.mjs` builds webp variants (covers 360/540/720, episodes 480/720/960)
   and a 16px blur placeholder for each image. It uploads the variants to the R2 bucket `glgroup`
   under `drama-serials/`, served as `https://cdn.affinet.link/...`, with content-hashed names and
   `Cache-Control: immutable`. Then it rewrites `lib/images.json`.

   ```bash
   R2_ACCOUNT_ID=... R2_ACCESS_KEY_ID=... R2_SECRET_ACCESS_KEY=... node scripts/publish-images.mjs
   ```
   The credentials are `AFFILIATE_NETWORK__R2_*` in `~/IdeaProjects/jenkins-job/.env`.

On the page, `components/CdnImage.tsx` sets `srcset`/`sizes`, the image dimensions and the blur
placeholder. The first covers on screen load eagerly with high priority, and the rest load lazily.
The layout preconnects to the CDN, and the sign-in dialog code loads only when the dialog first opens.

## Run locally

```bash
npm install
npm run dev            # or: npm run build && COOKIE_SECURE=false SESSION_SECRET=x npm start
```

## Deploy

`./deploy.sh` copies the code to `root@168.231.121.10:/opt/drama-serials/build` (without the
content, see above, unless `--push-content`), builds both images there and runs
`docker compose up -d`. It also installs the sync cron. On the first run it generates
`DB_PASSWORD`, `JWT_SECRET` and `STATS_KEY` in the server `.env`; the other keys are listed in
`.env.example`. Migrations (Alembic) run when the API starts. The nginx site is
`/etc/nginx/sites-available/affinet.link`, with TLS from certbot.
