// Meta Pixel events (components/MetaPixel.tsx). Without META_PIXEL_ID they do nothing.

type Fbq = (command: "track" | "trackCustom" | "init", name: string, params?: object, options?: { eventID: string }) => void;

declare global {
  interface Window {
    fbq?: Fbq;
    /** Events from this page load sent before the pixel was set up; MetaPixel sends them on load. */
    dsPixelQueue?: [string, object | undefined, string | undefined, boolean?][];
  }
}

export function trackPixel(event: string, params?: object, eventID?: string, custom = false): void {
  if (typeof window === "undefined") return;
  if (window.fbq) window.fbq(custom ? "trackCustom" : "track", event, params, eventID ? { eventID } : undefined);
  // A page's own effects run before the layout's: hold the event until the pixel is set up.
  else (window.dsPixelQueue ??= []).push([event, params, eventID, custom]);
}

/**
 * Our own viewing events for diagnosis in Events Manager (not for optimisation): SeriesStart when
 * a series' first episode starts playing, Episode3Start when its third does. Once per series per
 * browser, so swiping back and forth does not repeat them.
 */
export function trackViewing(slug: string, episode: number): void {
  const event = episode === 1 ? "SeriesStart" : episode === 3 ? "Episode3Start" : null;
  if (!event || typeof window === "undefined") return;
  const key = `ds_px_${event}_${slug}`;
  try {
    if (localStorage.getItem(key)) return;
    localStorage.setItem(key, "1");
  } catch {
    // Storage blocked: report anyway.
  }
  trackPixel(event, { content_ids: [slug], content_type: "product" }, undefined, true);
}

/** A purchase is reported once per payment, however often its page is reloaded. */
export function trackPurchaseOnce(
  paymentId: string,
  value: number,
  currency: string,
  contentName: string,
  slug?: string | null,
): void {
  if (typeof window === "undefined") return;
  const key = `ds_px_paid_${paymentId}`;
  try {
    if (localStorage.getItem(key)) return;
    localStorage.setItem(key, "1");
  } catch {
    // Storage blocked: report anyway; Meta also de-duplicates by eventID.
  }
  // Same fields and event id as the server's copy (backend/app/meta_capi.py): Meta keeps one.
  trackPixel(
    "Purchase",
    { value, currency, content_name: contentName, content_type: "product", ...(slug ? { content_ids: [slug] } : {}) },
    paymentId,
  );
}
