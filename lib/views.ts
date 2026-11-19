import "server-only";
import type { Serial } from "./catalog";

const API_URL = process.env.API_URL || "http://localhost:8020";

export interface RealViews {
  /** Episode opens per series slug. */
  series: Record<string, number>;
  /** Episode opens per `slug~n`. */
  episodes: Record<string, number>;
}

/** Real plays from the site's own counter (API /series-views), refreshed every 5 minutes. */
export async function getRealViews(): Promise<RealViews> {
  try {
    const response = await fetch(`${API_URL}/api/v1/series-views`, { next: { revalidate: 300 } });
    if (response.ok) return (await response.json()) as RealViews;
  } catch {
    // The showcase still renders, with zero counts.
  }
  return { series: {}, episodes: {} };
}

/**
 * The catalog's made-up counters replaced by real ones: views = episode plays, likes are not
 * counted on the server (shown as the viewer's own like only), ranks follow real views.
 */
export function withRealViews(serials: Serial[], views: RealViews): Serial[] {
  const counted = serials.map((serial) => ({
    ...serial,
    views: views.series[serial.slug] ?? 0,
    likes: 0,
    episodes: serial.episodes.map((episode) => ({ ...episode, views: views.episodes[episode.id] ?? 0, likes: 0 })),
  }));
  const order = [...counted].sort((a, b) => b.views - a.views || a.rank - b.rank);
  const rank = new Map(order.map((serial, index) => [serial.slug, index + 1]));
  return counted.map((serial) => ({ ...serial, rank: rank.get(serial.slug) ?? serial.rank }));
}
