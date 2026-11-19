// Turns the generated source images in assets/ into responsive webp variants,
// uploads them to the R2 bucket behind cdn.affinet.link and writes
// lib/images.json (URLs, widths, aspect ratio and a tiny blur placeholder).
//
// Usage: R2_ACCOUNT_ID=... R2_ACCESS_KEY_ID=... R2_SECRET_ACCESS_KEY=... \
//          node scripts/publish-images.mjs [--dry-run] [--from-media]
//
// --from-media first downloads photos uploaded to the media bucket (MEDIA_BUCKET, default
// an-serials-media; MEDIA_ACCESS_KEY_ID / MEDIA_SECRET_ACCESS_KEY, falling back to the R2_*
// key) into assets/, replacing the generated ones:
//   images/covers/<slug>.(jpg|png|webp)        → assets/covers/<slug>.webp
//   images/episodes/<slug>/<n>.(jpg|png|webp)  → assets/episodes/<slug>/<n>.webp
// File names carry a content hash, so objects are immutable and cached for a year;
// re-running only uploads what changed.
import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { GetObjectCommand, HeadObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { mkdir } from "node:fs/promises";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dryRun = process.argv.includes("--dry-run");
const BUCKET = process.env.R2_BUCKET || "glgroup";
const PREFIX = "drama-serials";
const PUBLIC_BASE = process.env.CDN_BASE_URL || "https://cdn.affinet.link";

// Widths cover a 2-column phone grid at 2-3x density up to a 5-column desktop grid.
const WIDTHS = { covers: [360, 540, 720], episodes: [480, 720, 960] };
const QUALITY = 74;

const s3 = dryRun
  ? null
  : new S3Client({
      region: "auto",
      endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
      },
    });

async function pullFromMedia() {
  const media = new S3Client({
    region: "auto",
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.MEDIA_ACCESS_KEY_ID || process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.MEDIA_SECRET_ACCESS_KEY || process.env.R2_SECRET_ACCESS_KEY,
    },
  });
  const bucket = process.env.MEDIA_BUCKET || "an-serials-media";
  const pattern = /^images\/(covers\/[a-z0-9-]+|episodes\/[a-z0-9-]+\/\d{1,3})\.(jpe?g|png|webp)$/i;
  let token;
  let pulled = 0;
  do {
    const page = await media.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: "images/", ContinuationToken: token }));
    for (const object of page.Contents ?? []) {
      const match = pattern.exec(object.Key);
      if (!match) continue;
      const body = await (await media.send(new GetObjectCommand({ Bucket: bucket, Key: object.Key }))).Body.transformToByteArray();
      const out = path.join(root, "assets", `${match[1]}.webp`);
      await mkdir(path.dirname(out), { recursive: true });
      // Normalised to webp at a generous size; variants are cut from this below.
      await sharp(Buffer.from(body)).rotate().resize({ width: 1440, withoutEnlargement: true }).webp({ quality: 90 }).toFile(out);
      pulled++;
    }
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
  console.log(`${pulled} photos pulled from ${bucket}`);
}

if (process.argv.includes("--from-media")) await pullFromMedia();

async function exists(key) {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
    return true;
  } catch {
    return false;
  }
}

async function upload(key, body) {
  if (dryRun || (await exists(key))) return false;
  await s3.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    Body: body,
    ContentType: "image/webp",
    CacheControl: "public, max-age=31536000, immutable",
  }));
  return true;
}

async function sources() {
  const list = [];
  for (const file of await readdir(path.join(root, "assets/covers"))) {
    if (file.endsWith(".webp")) list.push({ kind: "covers", id: `covers/${file.replace(".webp", "")}`, file: `assets/covers/${file}` });
  }
  for (const slug of await readdir(path.join(root, "assets/episodes"))) {
    for (const file of await readdir(path.join(root, "assets/episodes", slug))) {
      if (file.endsWith(".webp")) {
        list.push({ kind: "episodes", id: `episodes/${slug}/${file.replace(".webp", "")}`, file: `assets/episodes/${slug}/${file}` });
      }
    }
  }
  return list.sort((a, b) => a.id.localeCompare(b.id));
}

const manifest = {};
let uploaded = 0;
let bytes = 0;

for (const source of await sources()) {
  const input = await readFile(path.join(root, source.file));
  const hash = createHash("sha256").update(input).digest("hex").slice(0, 10);
  const meta = await sharp(input).metadata();
  const widths = WIDTHS[source.kind].filter((w) => w <= meta.width);
  if (widths.length === 0) widths.push(meta.width);

  for (const width of widths) {
    const body = await sharp(input).resize({ width }).webp({ quality: QUALITY, effort: 6 }).toBuffer();
    const key = `${PREFIX}/${source.id}.${hash}.${width}.webp`;
    if (await upload(key, body)) uploaded++;
    if (width === widths.at(-1)) bytes += body.length;
  }

  // ~16px wide placeholder, inlined as a CSS background until the real image arrives.
  const blur = await sharp(input).resize({ width: 16 }).webp({ quality: 40 }).toBuffer();
  manifest[source.id] = {
    src: `${PUBLIC_BASE}/${PREFIX}/${source.id}.${hash}.{w}.webp`,
    widths,
    aspect: Number((meta.width / meta.height).toFixed(4)),
    blur: `data:image/webp;base64,${blur.toString("base64")}`,
  };
}

await writeFile(path.join(root, "lib/images.json"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(
  `${Object.keys(manifest).length} images, ${uploaded} objects uploaded${dryRun ? " (dry run)" : ""}, ` +
  `largest variants total ${(bytes / 1024).toFixed(0)} KB`,
);
