import "server-only";
import { apiFetch } from "./api";
import type { OfferState } from "./billing-types";

export type BillingConfig = OfferState;

const FALLBACK: BillingConfig = {
  currency: "IDR",
  methods: [],
  products: [],
  launch: { active: false, ends_at: null, discount_percent: 0 },
  free_episodes: 0,
};

// Every page render (and every link prefetch) needs these: a minute in memory keeps the API idle.
const TTL_MS = 60_000;
const memo = new Map<string, { at: number; value: Promise<unknown> }>();

function cached<T>(key: string, load: () => Promise<T>, keep: (value: T) => boolean): Promise<T> {
  const hit = memo.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value as Promise<T>;
  const value = load().then((result) => {
    if (!keep(result)) memo.delete(key); // a failed call is not kept: the next render retries
    return result;
  });
  memo.set(key, { at: Date.now(), value });
  return value;
}

export async function getBillingConfig(): Promise<BillingConfig> {
  return cached(
    "config",
    async () => {
      const { status, data } = await apiFetch<BillingConfig>("/config");
      return status === 200 ? data : FALLBACK;
    },
    (value) => value !== FALLBACK,
  );
}

/** Real durations of uploaded videos, keyed `slug~episode`. */
export async function getMediaDurations(): Promise<Record<string, number>> {
  return cached(
    "media",
    async () => {
      const { status, data } = await apiFetch<{ slug: string; episode: number; duration: number | null }[]>("/media");
      if (status !== 200 || !Array.isArray(data)) return {};
      return Object.fromEntries(
        data.filter((m) => m.duration).map((m) => [`${m.slug}~${m.episode}`, m.duration as number]),
      );
    },
    (value) => Object.keys(value).length > 0,
  );
}
