// Link-preview banners (Open Graph, 1200×630) for WhatsApp, Telegram, Facebook, X:
//   public/og/home-<lang>.jpg       covers fan + logo + headline
//   public/og/<slug>-<lang>.jpg     one series: its cover on a blurred backdrop + title
// Rendered with satori (layout + Bricolage Grotesque) and resvg. Run after the covers change:
//   node scripts/og-images.mjs
import { access, readFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import satori from "satori";
import { Resvg } from "@resvg/resvg-js";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const W = 1200;
const H = 630;
const LOCALES = ["en", "id", "es", "ru"];

const COPY = {
  en: {
    headline: "Short dramas you can't stop watching",
    sub: "Romance, revenge and secrets in 2-minute episodes",
    pill: "Episodes from Rp 5.000",
    episodes: (n) => `${n} episodes`,
    genre: { melodrama: "Melodrama", drama: "Drama", thriller: "Thriller", comedy: "Comedy", action: "Action", detective: "Detective", romance: "Romance" },
  },
  id: {
    headline: "Drama pendek yang bikin nagih",
    sub: "Cinta, balas dendam, dan rahasia dalam episode 2 menit",
    pill: "Episode mulai Rp 5.000",
    episodes: (n) => `${n} episode`,
    genre: { melodrama: "Melodrama", drama: "Drama", thriller: "Thriller", comedy: "Komedi", action: "Aksi", detective: "Detektif", romance: "Romansa" },
  },
  es: {
    headline: "Microdramas que no vas a poder dejar",
    sub: "Amor, venganza y secretos en episodios de 2 minutos",
    pill: "Episodios desde Rp 5.000",
    episodes: (n) => `${n} episodios`,
    genre: { melodrama: "Melodrama", drama: "Drama", thriller: "Thriller", comedy: "Comedia", action: "Acción", detective: "Policíaca", romance: "Romance" },
  },
  ru: {
    headline: "Короткие сериалы, от которых не оторваться",
    sub: "Любовь, месть и тайны в сериях по паре минут",
    pill: "Серии от Rp 5.000",
    episodes: (n) => `${n} ${n % 10 === 1 && n % 100 !== 11 ? "серия" : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100) ? "серии" : "серий"}`,
    genre: { melodrama: "Мелодрама", drama: "Драма", thriller: "Триллер", comedy: "Комедия", action: "Боевик", detective: "Детектив", romance: "Романтика" },
  },
};

const fonts = [
  { name: "Bricolage", data: await readFile(path.join(root, "assets/fonts/BricolageGrotesque-500.ttf")), weight: 500 },
  { name: "Bricolage", data: await readFile(path.join(root, "assets/fonts/BricolageGrotesque-800.ttf")), weight: 800 },
  // Bricolage has no Cyrillic; satori takes missing glyphs from the next font.
  { name: "Manrope", data: await readFile(path.join(root, "assets/fonts/Manrope-500.ttf")), weight: 500 },
  { name: "Manrope", data: await readFile(path.join(root, "assets/fonts/Manrope-800.ttf")), weight: 800 },
];
const catalog = JSON.parse(await readFile(path.join(root, "lib/catalog.json"), "utf8"));
const markUri = `data:image/svg+xml;base64,${(await readFile(path.join(root, "app/icon.svg"))).toString("base64")}`;

const h = (type, style, ...children) => ({ type, props: { style: { display: "flex", ...style }, children } });
const img = (src, style) => ({ type: "img", props: { src, style } });

/** The cover with the title in `lang` when the series has one (imported series), else the shared one. */
async function coverFile(slug, lang) {
  const localized = path.join(root, "assets/covers", `${slug}.${lang}.webp`);
  try {
    await access(localized);
    return localized;
  } catch {
    return path.join(root, "assets/covers", `${slug}.webp`);
  }
}

async function coverUri(slug, width, lang = "en") {
  const jpg = await sharp(await coverFile(slug, lang)).resize({ width }).jpeg({ quality: 88 }).toBuffer();
  return `data:image/jpeg;base64,${jpg.toString("base64")}`;
}

function wordmark(size) {
  return h(
    "div",
    { alignItems: "center", gap: size * 0.32 },
    img(markUri, { width: size * 1.25, height: size * 1.25 }),
    h(
      "div",
      { fontSize: size, color: "#fff", letterSpacing: -size * 0.02 },
      h("span", { fontWeight: 800 }, "AN"),
      h("span", { fontWeight: 500, marginLeft: size * 0.25, color: "rgba(255,255,255,.85)" }, "Serials"),
    ),
  );
}

function pill(text) {
  return h(
    "div",
    {
      backgroundImage: "linear-gradient(90deg, #FF2E7E, #FF8A3D)",
      color: "#fff",
      fontSize: 28,
      fontWeight: 800,
      padding: "14px 28px",
      borderRadius: 999,
    },
    text,
  );
}

async function render(tree, out) {
  const svg = await satori(tree, { width: W, height: H, fonts });
  const png = new Resvg(svg, { fitTo: { mode: "width", value: W } }).render().asPng();
  await sharp(png).jpeg({ quality: 84, mozjpeg: true }).toFile(out);
}

const outDir = path.join(root, "public/og");
await mkdir(outDir, { recursive: true });

// Home: a fan of the three top covers.
for (const lang of LOCALES) {
  const fan = await Promise.all(catalog.slice(0, 3).map((s) => coverUri(s.slug, 600, lang)));
  const t = COPY[lang];
  const card = (src, left, top, angle, z) =>
    img(src, {
      position: "absolute",
      left,
      top,
      width: 300,
      height: 450,
      borderRadius: 22,
      transform: `rotate(${angle}deg)`,
      boxShadow: "0 30px 60px rgba(0,0,0,.6)",
      zIndex: z,
    });
  await render(
    h(
      "div",
      {
        width: W,
        height: H,
        position: "relative",
        backgroundColor: "#0D0D12",
        backgroundImage:
          "radial-gradient(circle at 12% 0%, rgba(255,46,126,.38), transparent 55%), radial-gradient(circle at 100% 100%, rgba(255,138,61,.28), transparent 50%)",
        fontFamily: "Bricolage",
      },
      card(fan[1], 640, 110, -10, 1),
      card(fan[2], 880, 110, 10, 1),
      card(fan[0], 760, 80, 0, 2),
      h(
        "div",
        { position: "absolute", left: 72, top: 64, width: 560, height: 502, flexDirection: "column", justifyContent: "space-between" },
        wordmark(44),
        h(
          "div",
          { flexDirection: "column", gap: 20 },
          h("div", { fontSize: 62, fontWeight: 800, color: "#fff", lineHeight: 1.04, letterSpacing: -1.5 }, t.headline),
          h("div", { fontSize: 28, fontWeight: 500, color: "rgba(255,255,255,.72)", lineHeight: 1.3 }, t.sub),
        ),
        h("div", {}, pill(t.pill)),
      ),
    ),
    path.join(outDir, `home-${lang}.jpg`),
  );
}

// One per series: its cover, big, on a blurred copy of itself.
for (const serial of catalog) {
  for (const lang of LOCALES) {
    const t = COPY[lang];
    const cover = await coverUri(serial.slug, 720, lang);
    const backdrop = await sharp(await coverFile(serial.slug, lang))
      .resize(W, H, { fit: "cover" })
      .blur(40)
      .modulate({ brightness: 0.45, saturation: 1.2 })
      .jpeg({ quality: 70 })
      .toBuffer();
    const backdropUri = `data:image/jpeg;base64,${backdrop.toString("base64")}`;
    await render(
      h(
        "div",
        { width: W, height: H, position: "relative", backgroundColor: "#0D0D12", fontFamily: "Bricolage" },
        img(backdropUri, { position: "absolute", left: 0, top: 0, width: W, height: H }),
        img(cover, {
          position: "absolute",
          left: 80,
          top: 45,
          width: 360,
          height: 540,
          borderRadius: 24,
          boxShadow: "0 30px 70px rgba(0,0,0,.65)",
        }),
        h(
          "div",
          { position: "absolute", left: 500, top: 70, width: 630, height: 490, flexDirection: "column", justifyContent: "space-between" },
          wordmark(36),
          h(
            "div",
            { flexDirection: "column", gap: 18 },
            h("div", { fontSize: 60, fontWeight: 800, color: "#fff", lineHeight: 1.05, letterSpacing: -1.5 }, serial.title[lang] ?? serial.title.en),
            h(
              "div",
              { fontSize: 28, fontWeight: 500, color: "rgba(255,255,255,.75)" },
              `${t.genre[serial.genre] ?? serial.genre} · ${t.episodes(serial.episodes.length)}`,
            ),
          ),
          h("div", {}, pill(t.pill)),
        ),
      ),
      path.join(outDir, `${serial.slug}-${lang}.jpg`),
    );
  }
}
console.log("og images written to public/og");
