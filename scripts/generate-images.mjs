// Generates cover posters and episode stills, then writes compressed webp
// source files into assets/ (published to the CDN by publish-images.mjs). Two providers:
//   ark    — Seedream on BytePlus Ark (ARK_API_KEY, IMAGE_MODEL = Ark model id)
//   openai — OpenAI Images API (OPENAI_API_KEY)
//
// Usage: IMAGE_PROVIDER=ark ARK_API_KEY=... IMAGE_MODEL=... \
//          node scripts/generate-images.mjs [--only covers|episodes] [--match <text>] [--force]
// Existing files are skipped unless --force is passed.
import { readFile, mkdir, access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const provider = process.env.IMAGE_PROVIDER || "ark";
const apiKey = provider === "ark" ? process.env.ARK_API_KEY : process.env.OPENAI_API_KEY;
if (!apiKey) {
  console.error(`${provider === "ark" ? "ARK_API_KEY" : "OPENAI_API_KEY"} is not set`);
  process.exit(1);
}

const args = process.argv.slice(2);
const force = args.includes("--force");
const only = args.includes("--only") ? args[args.indexOf("--only") + 1] : null;
const match = args.includes("--match") ? args[args.indexOf("--match") + 1] : null;
const model = process.env.IMAGE_MODEL || (provider === "ark" ? "" : "gpt-image-2");
if (!model) {
  console.error("IMAGE_MODEL is not set (Ark model id)");
  process.exit(1);
}
// Portrait 2:3 for covers, landscape 3:2 for episode stills.
const SIZES = provider === "ark"
  ? { cover: "1728x2592", episode: "2592x1728" }
  : { cover: "1024x1536", episode: "1536x1024" };
const quality = process.env.IMAGE_QUALITY || "medium";
const concurrency = Number(process.env.IMAGE_CONCURRENCY || 4);

const catalog = JSON.parse(await readFile(path.join(root, "lib/catalog.json"), "utf8"));

const exists = (file) => access(file).then(() => true, () => false);

function coverPrompt(serial) {
  return [
    "Vertical poster for a mobile short-drama streaming series, glossy cinematic digital painting,",
    "photorealistic attractive fictional characters with expressive faces, dramatic lighting, rich saturated colours,",
    "layered composition with the main characters large in the upper two thirds.",
    `Scene: ${serial.coverPrompt}.`,
    `In the lower third, the series title in English, spelled exactly: "${serial.title.en}".`,
    `Title lettering: ${serial.titleStyle}, large, sharp, perfectly legible, correctly spelled, with a subtle dark shadow.`,
    "No other text, no logos, no watermarks, no borders.",
  ].join(" ");
}

function episodePrompt(serial, episode) {
  return [
    "Cinematic film still from a modern short-drama series, photorealistic, shallow depth of field,",
    "dramatic moody lighting, rich colour grading, fictional characters.",
    `Series mood: ${serial.genre}. Scene: ${episode.prompt}.`,
    "No text, no captions, no logos, no watermarks.",
  ].join(" ");
}

const jobs = [];
for (const serial of catalog) {
  if (only !== "episodes") {
    jobs.push({
      out: path.join(root, "assets/covers", `${serial.slug}.webp`),
      prompt: coverPrompt(serial),
      size: SIZES.cover,
      width: 720,
    });
  }
  if (only !== "covers") {
    serial.episodes.forEach((episode, index) => {
      jobs.push({
        out: path.join(root, "assets/episodes", serial.slug, `${index + 1}.webp`),
        prompt: episodePrompt(serial, episode),
        size: SIZES.episode,
        width: 960,
      });
    });
  }
}

async function request(job) {
  if (provider === "ark") {
    return fetch("https://ark.ap-southeast.bytepluses.com/api/v3/images/generations", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, prompt: job.prompt, size: job.size, response_format: "b64_json", watermark: false }),
    });
  }
  return fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, prompt: job.prompt, size: job.size, quality, n: 1 }),
  });
}

async function generate(job, attempt = 1) {
  const response = await request(job);
  if (!response.ok) {
    const text = await response.text();
    // Out-of-credit 429s never recover, so only rate limits and 5xx are retried.
    const retryable = (response.status === 429 && !/insufficient_quota|credit/i.test(text)) || response.status >= 500;
    if (attempt < 3 && retryable) {
      await new Promise((resolve) => setTimeout(resolve, 15000 * attempt));
      return generate(job, attempt + 1);
    }
    throw new Error(`${response.status} ${text.slice(0, 300)}`);
  }
  const data = await response.json();
  const image = Buffer.from(data.data[0].b64_json, "base64");
  await mkdir(path.dirname(job.out), { recursive: true });
  await sharp(image).resize({ width: job.width }).webp({ quality: 82 }).toFile(job.out);
}

const pending = [];
for (const job of jobs) {
  if (match && !job.out.includes(match)) continue;
  if (force || !(await exists(job.out))) pending.push(job);
}
console.log(`${jobs.length} images total, ${pending.length} to generate (${provider})`);

let failed = 0;
let cursor = 0;
async function worker() {
  while (cursor < pending.length) {
    const job = pending[cursor++];
    const name = path.relative(root, job.out);
    try {
      await generate(job);
      console.log(`ok   ${name}`);
    } catch (error) {
      failed++;
      console.error(`FAIL ${name}: ${error.message}`);
    }
  }
}
await Promise.all(Array.from({ length: concurrency }, worker));
console.log(failed ? `done with ${failed} failures` : "done");
process.exit(failed ? 1 : 0);
