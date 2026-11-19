// Shapes shared by the payment routes and the client pages.

export type PayMethod = "QRIS" | "CREDIT_CARD" | "SBP";
export type ProductId = "series_day" | "week" | "month" | "year" | "episode";

export interface PriceView {
  id: ProductId;
  /** episode: one for good; series: one series for `hours`; vip: every series for `days`. */
  kind: "episode" | "series" | "vip";
  days: number | null;
  hours: number | null;
  /** What is charged now. */
  price: number;
  /** Crossed out while the launch price runs. */
  regular_price: number;
}

/** Prices and plans (API /config and /offer), in the paywall's order. */
export interface OfferState {
  currency: string;
  methods: PayMethod[];
  products: PriceView[];
  /** The launch price and its real end date; after it the regular prices are charged. */
  launch: { active: boolean; ends_at: string | null; discount_percent: number };
  /** The first episodes of every series play free, without signing in. */
  free_episodes: number;
}

export interface AccountView {
  email: string;
  access_until: string | null;
  has_access: boolean;
  episodes: { slug: string; episode: number }[];
  /** One-series passes still running. */
  series_passes: { slug: string; until: string }[];
}

export interface PaymentState {
  id: string;
  status: "pending" | "paid" | "expired" | "failed";
  amount: number;
  currency: string;
  invoice_url: string | null;
  next: string | null;
  product: ProductId;
  episode: number | null;
  account: AccountView;
  error?: string;
}

/** "Rp 9.900": rupiah use dots for thousands whatever the UI language. */
export function formatIdr(amount: number): string {
  return `Rp ${amount.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".")}`;
}

/** 95 → "1:35". */
export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
