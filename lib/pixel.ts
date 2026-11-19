// Meta Pixel events (components/MetaPixel.tsx). Without META_PIXEL_ID they do nothing.

type Fbq = (command: "track" | "init", name: string, params?: object, options?: { eventID: string }) => void;

declare global {
  interface Window {
    fbq?: Fbq;
    /** Events from this page load sent before the pixel was set up; MetaPixel sends them on load. */
    dsPixelQueue?: [string, object | undefined, string | undefined][];
  }
}

export function trackPixel(event: string, params?: object, eventID?: string): void {
  if (typeof window === "undefined") return;
  if (window.fbq) window.fbq("track", event, params, eventID ? { eventID } : undefined);
  // A page's own effects run before the layout's: hold the event until the pixel is set up.
  else (window.dsPixelQueue ??= []).push([event, params, eventID]);
}

/** A purchase is reported once per payment, however often its page is reloaded. */
export function trackPurchaseOnce(paymentId: string, value: number, currency: string, contentName: string): void {
  if (typeof window === "undefined") return;
  const key = `ds_px_paid_${paymentId}`;
  try {
    if (localStorage.getItem(key)) return;
    localStorage.setItem(key, "1");
  } catch {
    // Storage blocked: report anyway; Meta also de-duplicates by eventID.
  }
  trackPixel("Purchase", { value, currency, content_name: contentName }, paymentId);
}
