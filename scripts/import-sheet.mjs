// Imports real series from the content team's Google Sheet into lib/catalog.json.
//
// Sheet columns (one row per episode and language):
//   Ссылка | Сериал | Серия | Кусок | Язык | Заголовок | Описание | Превью | Обложка сериала | VIP
//   video URL on cdn.affinet.link | series title | "1. Episode title" | part ("целиком (47 с)")
//   | RU/ID/EN/ES | hook line | description (#hashtags are stripped) | episode preview URL | cover URL
//   | VIP mark (да / yes / 1 / ✓ on any row of a series makes it VIP-only: watched with a pass only)
//
// For every row it:
//   - writes the texts for that language into the series (matched by the video's top folder,
//     kept as `source`; a new folder becomes a new series with slug = folder — rename it after);
//   - copies the video inside the bucket to <VIDEO_PREFIX><slug>/<lang>/<n>.mp4, where the API's
//     media scanner picks it up (duration, signed playback URLs);
//   - reads the duration with ffprobe;
//   - saves the preview and cover into assets/. When the sheet's image is missing (404), a frame
//     of the video is used instead (catalog fields `frameAt` per episode, `coverFrame` per series),
//     and the cover gets the title drawn on it in each site language.
// Languages without a sheet column (e.g. EN/ES) keep what catalog.json already has.
//
// Usage:
//   R2_ACCOUNT_ID=... R2_ACCESS_KEY_ID=... R2_SECRET_ACCESS_KEY=... node scripts/import-sheet.mjs [--sheet <id>] [--dry-run]
// then: node scripts/publish-images.mjs && node scripts/og-images.mjs, rebuild and deploy.
import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { CopyObjectCommand, HeadObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { Resvg } from "@resvg/resvg-js";
import satori from "satori";
import sharp from "sharp";

const run = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const dryRun = process.argv.includes("--dry-run");
const SHEET_ID = arg("--sheet") || process.env.SHEET_ID || "1qEIFe4_hlbBFAo-KhU8gYLrXByklhrWKXtxlmWZXCao";
const CDN_HOST = "cdn.affinet.link";
const BUCKET = process.env.R2_BUCKET || "glgroup"; // the bucket behind cdn.affinet.link
const VIDEO_PREFIX = process.env.VIDEO_PREFIX || "drama-serials/video/"; // = MEDIA_PREFIX of the API
const SITE_LOCALES = ["en", "id", "es", "ru"];
// Whose frames and previews to prefer when the language cuts differ only by audio.
const LANG_PREFERENCE = ["id", "en", "es", "ru"];

// --- sheet -------------------------------------------------------------------------------------

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') (field += '"'), i++;
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") row.push(field), (field = "");
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field), rows.push(row), (row = []), (field = "");
    } else field += c;
  }
  if (field || row.length) row.push(field), rows.push(row);
  return rows.filter((r) => r.some((cell) => cell.trim()));
}

const COLUMNS = {
  url: /^ссылка|^link|^video/i,
  series: /^сериал|^series/i,
  episode: /^серия|^episode/i,
  part: /^кусок|^part/i,
  lang: /^язык|^lang/i,
  headline: /^заголовок|^headline/i,
  description: /^описание|^description/i,
  preview: /^превью|^preview/i,
  cover: /^обложка|^cover/i,
  vip: /^vip/i,
};
const VIP_MARK = /^(да|yes|y|1|true|vip|✓|✔|x|\+)$/i;
// Set by loadSheet: without a VIP column the catalog's own marks stay as they are.
let sheetHasVip = false;

async function loadSheet() {
  const response = await fetch(`https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv`);
  if (!response.ok) throw new Error(`sheet: HTTP ${response.status} (is it shared "anyone with the link"?)`);
  const [header, ...body] = parseCsv(await response.text());
  const index = Object.fromEntries(
    Object.entries(COLUMNS).map(([key, pattern]) => [key, header.findIndex((h) => pattern.test(h.trim()))]),
  );
  sheetHasVip = index.vip >= 0;
  for (const key of ["url", "series", "episode", "lang"]) {
    if (index[key] < 0) throw new Error(`sheet: no "${key}" column in ${header.join(" | ")}`);
  }
  return body.map((cells, i) => ({
    line: i + 2,
    ...Object.fromEntries(Object.entries(index).map(([key, col]) => [key, col < 0 ? "" : (cells[col] ?? "").trim()])),
  }));
}

const WHOLE = /целиком|utuh|whole|full|entero|completo/i;
const stripTags = (text) => text.replace(/(^|\s)#[^\s#]+/gu, "").replace(/\s+$/u, "").trim();

// --- media helpers -----------------------------------------------------------------------------

const s3 = new S3Client({
  region: "auto",
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID ?? "", secretAccessKey: process.env.R2_SECRET_ACCESS_KEY ?? "" },
});

async function head(key) {
  try {
    return await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
  } catch {
    return null;
  }
}

async function copyVideo(from, to) {
  const [source, target] = await Promise.all([head(from), head(to)]);
  if (!source) throw new Error(`video ${from} is not in bucket ${BUCKET}`);
  if (target && target.ContentLength === source.ContentLength && target.ETag === source.ETag) return false;
  if (dryRun) return true;
  await s3.send(
    new CopyObjectCommand({
      Bucket: BUCKET,
      Key: to,
      CopySource: `${BUCKET}/${from.split("/").map(encodeURIComponent).join("/")}`,
      ContentType: "video/mp4",
      MetadataDirective: "REPLACE",
    }),
  );
  return true;
}

async function duration(url) {
  const { stdout } = await run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", url]);
  return Math.round(Number(stdout.trim()));
}

async function frame(url, seconds) {
  const { stdout } = await run(
    "ffmpeg",
    ["-v", "error", "-ss", String(seconds), "-i", url, "-frames:v", "1", "-f", "image2pipe", "-vcodec", "png", "-"],
    { encoding: "buffer", maxBuffer: 64 * 1024 * 1024 },
  );
  return stdout;
}

/** The image at `url`, or null when it is not there yet. */
async function download(url) {
  if (!url) return null;
  const response = await fetch(url);
  if (!response.ok) return null;
  return Buffer.from(await response.arrayBuffer());
}

async function saveWebp(buffer, file) {
  if (dryRun) return;
  await mkdir(path.dirname(file), { recursive: true });
  await sharp(buffer).rotate().resize({ width: 1440, withoutEnlargement: true }).webp({ quality: 90 }).toFile(file);
}

// --- covers ------------------------------------------------------------------------------------
// The grid, series header and link previews all expect 2:3, so taller covers (9:16) are cut to it.
const COVER_W = 720;
const COVER_H = 1080;
/** Video frames are cut evenly; designed covers lose more at the top so the lettering stays whole. */
async function toCoverShape(buffer, { lettered = false } = {}) {
  const image = sharp(await sharp(buffer).rotate().toBuffer());
  const { width, height } = await image.metadata();
  const target = Math.round((width * COVER_H) / COVER_W);
  if (height > target) {
    const top = Math.round((height - target) * (lettered ? 0.95 : 0.5));
    image.extract({ left: 0, top, width, height: target });
  }
  return image.resize(COVER_W, COVER_H, { fit: "cover" }).jpeg({ quality: 92 }).toBuffer();
}

const fonts = [
  { name: "Bricolage", data: await readFile(path.join(root, "assets/fonts/BricolageGrotesque-500.ttf")), weight: 500 },
  { name: "Bricolage", data: await readFile(path.join(root, "assets/fonts/BricolageGrotesque-800.ttf")), weight: 800 },
  { name: "Manrope", data: await readFile(path.join(root, "assets/fonts/Manrope-500.ttf")), weight: 500 },
  { name: "Manrope", data: await readFile(path.join(root, "assets/fonts/Manrope-800.ttf")), weight: 800 },
];
const h = (type, style, ...children) => ({ type, props: { style: { display: "flex", ...style }, children } });

/**
 * A cover with the title drawn in one language. `base` is either a video frame or the team's cover
 * in another language; for the latter (`repaint`), its lettering at the bottom is painted over.
 */
async function titledCover(base, { title, tagline, repaint }) {
  const W = COVER_W;
  const H = COVER_H;
  const photo = await toCoverShape(base, { lettered: repaint });
  // "After the Divorce, the Hotel Is Mine" → gold lead line + big white line, like the team's covers.
  const comma = title.indexOf(",");
  const [lead, main] = comma > 0 ? [title.slice(0, comma), title.slice(comma + 1).trim()] : ["", title];
  const shade = repaint
    ? "linear-gradient(180deg, rgba(6,6,9,0) 58%, rgba(6,6,9,.9) 67%, #060609 72%, #060609 100%)"
    : "linear-gradient(180deg, rgba(0,0,0,0) 42%, rgba(0,0,0,.55) 66%, rgba(0,0,0,.92) 100%)";
  const shadow = "0 3px 14px rgba(0,0,0,.85)";
  const svg = await satori(
    h(
      "div",
      { width: W, height: H, position: "relative", fontFamily: "Bricolage" },
      { type: "img", props: { src: `data:image/jpeg;base64,${photo.toString("base64")}`, style: { position: "absolute", left: 0, top: 0, width: W, height: H } } },
      h("div", { position: "absolute", left: 0, top: 0, width: W, height: H, backgroundImage: shade }),
      h(
        "div",
        { position: "absolute", left: 36, right: 36, bottom: tagline ? 40 : 64, flexDirection: "column", alignItems: "center" },
        lead
          ? h("div", { fontSize: 46, fontWeight: 800, color: "#E8C27A", letterSpacing: 1, textShadow: shadow, textAlign: "center" }, lead.toUpperCase())
          : null,
        h(
          "div",
          { fontSize: main.length > 18 ? 54 : 62, fontWeight: 800, color: "#fff", lineHeight: 1.05, letterSpacing: 0.5, marginTop: 4, textShadow: shadow, textAlign: "center", justifyContent: "center" },
          main.toUpperCase(),
        ),
        tagline ? h("div", { width: 150, height: 2, marginTop: 18, backgroundColor: "rgba(232,194,122,.7)" }) : null,
        tagline
          ? h("div", { fontSize: 22, fontWeight: 500, color: "rgba(255,255,255,.88)", lineHeight: 1.35, marginTop: 14, textAlign: "center", justifyContent: "center" }, tagline)
          : null,
      ),
    ),
    { width: W, height: H, fonts },
  );
  return new Resvg(svg, { fitTo: { mode: "width", value: W } }).render().asPng();
}

// --- import ------------------------------------------------------------------------------------

const catalogFile = path.join(root, "lib/catalog.json");
const catalog = JSON.parse(await readFile(catalogFile, "utf8"));
const rows = await loadSheet();
const warnings = [];
const groups = new Map();

for (const row of rows) {
  let url;
  try {
    url = new URL(row.url);
  } catch {
    warnings.push(`line ${row.line}: not a link: "${row.url}"`);
    continue;
  }
  if (url.host !== CDN_HOST) {
    warnings.push(`line ${row.line}: video must be on ${CDN_HOST}, got ${url.host}`);
    continue;
  }
  if (row.part && !WHOLE.test(row.part)) {
    warnings.push(`line ${row.line}: part "${row.part}" skipped (only whole episodes are imported)`);
    continue;
  }
  const number = Number(/^\s*(\d+)/.exec(row.episode)?.[1]);
  const lang = row.lang.toLowerCase().slice(0, 2);
  if (!number || !/^[a-z]{2}$/.test(lang)) {
    warnings.push(`line ${row.line}: cannot read episode "${row.episode}" / language "${row.lang}"`);
    continue;
  }
  const key = decodeURIComponent(url.pathname.slice(1));
  const source = key.split("/")[0];
  if (!groups.has(source)) groups.set(source, []);
  groups.get(source).push({ ...row, number, lang, key, title: row.episode.replace(/^\s*\d+\s*[.)-]?\s*/, "") });
}

let copied = 0;
for (const [source, items] of groups) {
  let serial = catalog.find((s) => s.source === source);
  if (!serial) {
    serial = { slug: source, source, rank: 1, tag: "new", genre: "drama", views: 0, likes: 0, title: {}, synopsis: {}, episodes: [] };
    for (const other of catalog) other.rank += 1;
    catalog.unshift(serial);
    warnings.push(`${source}: new series — check slug, synopsis and EN/ES texts in lib/catalog.json`);
  }
  const byLang = (list) => [...list].sort((a, b) => LANG_PREFERENCE.indexOf(a.lang) - LANG_PREFERENCE.indexOf(b.lang));

  for (const item of byLang(items)) {
    serial.title[item.lang] = item.series;
    const episode = (serial.episodes[item.number - 1] ??= { title: {}, headline: {}, description: {}, duration: 0 });
    episode.title[item.lang] = item.title;
    if (item.headline) (episode.headline ??= {})[item.lang] = item.headline;
    if (item.description) episode.description[item.lang] = stripTags(item.description);
    const target = `${VIDEO_PREFIX}${serial.slug}/${item.lang}/${item.number}${path.extname(item.key) || ".mp4"}`;
    if (await copyVideo(item.key, target)) copied++;
  }
  serial.episodes = serial.episodes.filter(Boolean);
  if (sheetHasVip) {
    if (items.some((item) => VIP_MARK.test(item.vip))) serial.vip = true;
    else delete serial.vip;
  }

  // Durations, previews and frames come from the preferred language's cut.
  const numbers = [...new Set(items.map((i) => i.number))].sort((a, b) => a - b);
  const videoOf = (n) => `https://${CDN_HOST}/${byLang(items.filter((i) => i.number === n))[0].key}`;
  for (const n of numbers) {
    const episode = serial.episodes[n - 1];
    episode.duration = await duration(videoOf(n));
    const given = byLang(items.filter((i) => i.number === n && i.preview));
    let image = null;
    for (const item of given) if ((image = await download(item.preview))) break;
    if (!image) {
      image = await frame(videoOf(n), episode.frameAt ?? Math.round(episode.duration * 0.3));
      if (given.length) warnings.push(`${serial.slug} ep${n}: preview ${given[0].preview} not found, using a video frame`);
    }
    await saveWebp(image, path.join(root, "assets/episodes", serial.slug, `${n}.webp`));
  }

  // Covers for every site language: the sheet's own cover in that language; otherwise another
  // language's cover with the lettering redrawn; otherwise a video frame with the title.
  const sheetCovers = new Map();
  for (const item of byLang(items.filter((i) => i.cover))) {
    if (sheetCovers.has(item.lang)) continue;
    const image = await download(item.cover);
    if (image) sheetCovers.set(item.lang, image);
    else warnings.push(`${serial.slug}: cover ${item.cover} not found`);
  }
  const coverFrame = serial.coverFrame ?? { episode: numbers[0], at: 3 };
  const donor = sheetCovers.values().next().value ?? (await frame(videoOf(coverFrame.episode), coverFrame.at));
  for (const lang of SITE_LOCALES) {
    let cover = sheetCovers.get(lang);
    if (cover) cover = await toCoverShape(cover, { lettered: true });
    else {
      const title = serial.title[lang] ?? serial.title.en ?? serial.title.id ?? Object.values(serial.title)[0];
      cover = await titledCover(donor, { title, tagline: serial.coverTagline?.[lang], repaint: sheetCovers.size > 0 });
    }
    await saveWebp(cover, path.join(root, "assets/covers", `${serial.slug}.${lang}.webp`));
    // The language-neutral file is the English one (fallback, OG backdrop).
    if (lang === "en") await saveWebp(cover, path.join(root, "assets/covers", `${serial.slug}.webp`));
  }

  for (const lang of SITE_LOCALES) {
    const missing = serial.episodes.some((e) => !e.title[lang] || !e.description[lang]) || !serial.title[lang] || !serial.synopsis[lang];
    if (missing) warnings.push(`${serial.slug}: no ${lang.toUpperCase()} texts in the sheet or catalog — the site shows English/Indonesian instead`);
  }
  console.log(`${serial.slug}: ${numbers.length} episodes (${[...new Set(items.map((i) => i.lang))].join(", ")})`);
}

if (!dryRun) await writeFile(catalogFile, `${JSON.stringify(catalog, null, 2)}\n`);
console.log(`${rows.length} rows, ${copied} videos copied to ${BUCKET}/${VIDEO_PREFIX}${dryRun ? " (dry run)" : ""}`);
for (const warning of warnings) console.warn(`! ${warning}`);
