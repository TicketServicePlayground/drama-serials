import type { Metadata } from "next";
import type { Serial } from "./catalog";
import { getDictionary, LOCALES, withLocale, type Locale } from "./i18n";

export const SITE_URL = "https://affinet.link";
const OG_LOCALE: Record<Locale, string> = { en: "en_US", id: "id_ID", es: "es_ES", ru: "ru_RU" };

const COPY: Record<Locale, { title: string; description: string; tagline: string; from: string }> = {
  en: {
    title: "AN Serials — short drama series",
    description:
      "Short drama series in 2-minute episodes: romance, revenge, billionaires and secrets. New stories every week, the first episodes are free.",
    tagline: "Short dramas you can't stop watching",
    from: "first episodes free",
  },
  id: {
    title: "AN Serials — serial drama pendek",
    description:
      "Serial drama pendek dengan episode 2 menit: cinta, balas dendam, miliarder, dan rahasia. Cerita baru setiap minggu, episode pertama gratis.",
    tagline: "Drama pendek yang bikin nagih",
    from: "episode pertama gratis",
  },
  es: {
    title: "AN Serials — series de microdramas",
    description:
      "Series de microdramas en episodios de 2 minutos: amor, venganza, millonarios y secretos. Historias nuevas cada semana, los primeros episodios son gratis.",
    tagline: "Microdramas que no vas a poder dejar",
    from: "primeros episodios gratis",
  },
  ru: {
    title: "AN Serials — короткие сериалы",
    description:
      "Короткие сериалы с сериями по паре минут: любовь, месть, миллиардеры и тайны. Новые истории каждую неделю, первые серии бесплатно.",
    tagline: "Короткие сериалы, от которых не оторваться",
    from: "первые серии бесплатно",
  },
};

/** Link-preview and search metadata; banners come from scripts/og-images.mjs. */
export function pageMetadata(locale: Locale, path: string, serial?: Serial): Metadata {
  const copy = COPY[locale];
  const t = getDictionary(locale);
  const title = serial ? `${serial.title} — AN Serials` : copy.title;
  const description = serial
    ? `${serial.synopsis} ${t.genre[serial.genre] ?? serial.genre} · ${t.auth.episodes(serial.episodes.length)}, ${copy.from}.`
    : copy.description;
  const image = `/og/${serial ? serial.slug : "home"}-${locale}.jpg`;
  const url = withLocale(path, locale);
  return {
    metadataBase: new URL(SITE_URL),
    title: { absolute: title },
    description,
    applicationName: "AN Serials",
    alternates: {
      canonical: url,
      languages: Object.fromEntries(LOCALES.map((l) => [l, withLocale(path, l)])),
    },
    openGraph: {
      type: "website",
      siteName: "AN Serials",
      url,
      title,
      description,
      locale: OG_LOCALE[locale],
      alternateLocale: LOCALES.filter((l) => l !== locale).map((l) => OG_LOCALE[l]),
      images: [{ url: image, width: 1200, height: 630, alt: serial ? serial.title : copy.tagline, type: "image/jpeg" }],
    },
    twitter: { card: "summary_large_image", title, description, images: [image] },
    appleWebApp: { title: "AN Serials" },
  };
}
