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

export async function getBillingConfig(): Promise<BillingConfig> {
  const { status, data } = await apiFetch<BillingConfig>("/config");
  return status === 200 ? data : FALLBACK;
}

/** Real durations of uploaded videos, keyed `slug~episode`. */
export async function getMediaDurations(): Promise<Record<string, number>> {
  const { status, data } = await apiFetch<{ slug: string; episode: number; duration: number | null }[]>("/media");
  if (status !== 200 || !Array.isArray(data)) return {};
  return Object.fromEntries(
    data.filter((m) => m.duration).map((m) => [`${m.slug}~${m.episode}`, m.duration as number]),
  );
}
