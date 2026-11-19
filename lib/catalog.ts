import rawCatalog from "./catalog.json";
import type { Locale } from "./i18n";
import { imageRef, type ImageRef } from "./images";

/** Text per language. Imported series may carry extra languages (e.g. `ru`) or miss some. */
type Texts = Partial<Record<string, string>>;

interface RawEpisode {
  title: Texts;
  /** One-line hook shown above the description (imported series). */
  headline?: Texts;
  description: Texts;
  duration: number;
}

interface RawSerial {
  slug: string;
  /** Folder on the CDN the series was imported from (scripts/import-sheet.mjs). */
  source?: string;
  rank: number;
  tag: string;
  /** VIP series (sheet column "VIP"): watched only with a VIP pass, episodes are not sold alone. */
  vip?: boolean;
  genre: string;
  views: number;
  likes: number;
  title: Texts;
  synopsis: Texts;
  episodes: RawEpisode[];
}

const raw = rawCatalog as RawSerial[];

/** The requested language, then English, then whatever the series has. */
function pick(texts: Texts | undefined, locale: Locale): string {
  if (!texts) return "";
  return texts[locale] ?? texts.en ?? texts.id ?? Object.values(texts).find(Boolean) ?? "";
}

export interface Episode {
  /** Like id: `<slug>~<number>`. */
  id: string;
  number: number;
  title: string;
  headline: string;
  description: string;
  image: ImageRef | null;
  /** Seconds. Demo value from the catalog until a video is uploaded (see getMediaDurations). */
  duration: number;
  views: number;
  likes: number;
}

export interface Serial {
  slug: string;
  title: string;
  rank: number;
  tag: "dub" | "new";
  vip: boolean;
  genre: string;
  synopsis: string;
  cover: ImageRef | null;
  views: number;
  likes: number;
  episodes: Episode[];
}

// Later episodes are watched by fewer people, as on real short-drama apps.
const EPISODE_RETENTION = [0.42, 0.27, 0.19, 0.12];

export function getCatalog(locale: Locale): Serial[] {
  return raw.map((serial) => ({
    slug: serial.slug,
    title: pick(serial.title, locale),
    rank: serial.rank,
    tag: serial.tag as Serial["tag"],
    vip: serial.vip === true,
    genre: serial.genre,
    synopsis: pick(serial.synopsis, locale),
    // A cover with the title in the viewer's language when there is one.
    cover: imageRef(`covers/${serial.slug}.${locale}`) ?? imageRef(`covers/${serial.slug}`),
    views: serial.views,
    likes: serial.likes,
    episodes: serial.episodes.map((episode, index) => {
      const share = EPISODE_RETENTION[index] ?? 0.1;
      return {
        id: `${serial.slug}~${index + 1}`,
        number: index + 1,
        title: pick(episode.title, locale),
        headline: pick(episode.headline, locale),
        description: pick(episode.description, locale),
        image: imageRef(`episodes/${serial.slug}/${index + 1}`),
        duration: episode.duration,
        views: Math.round(serial.views * share),
        likes: Math.round(serial.likes * share * 0.8),
      };
    }),
  }));
}

/** Whether a series is VIP-only; the same in every language. */
export function isVipSerial(slug: string): boolean {
  return raw.some((serial) => serial.slug === slug && serial.vip === true);
}

export function findSerial(slug: string, locale: Locale): Serial | undefined {
  return getCatalog(locale).find((serial) => serial.slug === slug);
}

/** What a showcase tile needs; the episodes themselves stay on the series page. */
export interface SerialCard {
  slug: string;
  title: string;
  rank: number;
  tag: Serial["tag"];
  vip: boolean;
  cover: ImageRef | null;
  views: number;
  likes: number;
  episodeCount: number;
  /** Seconds, rounded. */
  avgDuration: number;
}

/** `durations`: real lengths of uploaded videos, keyed `slug~n`; catalog values fill the gaps. */
export function toCard(serial: Serial, durations: Record<string, number> = {}): SerialCard {
  const lengths = serial.episodes.map((e) => durations[e.id] ?? e.duration);
  return {
    slug: serial.slug,
    title: serial.title,
    rank: serial.rank,
    tag: serial.tag,
    vip: serial.vip,
    cover: serial.cover,
    views: serial.views,
    likes: serial.likes,
    episodeCount: serial.episodes.length,
    avgDuration: Math.round(lengths.reduce((a, b) => a + b, 0) / Math.max(1, lengths.length)),
  };
}
