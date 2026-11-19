// The site's own counter (backend/app/visits.py): page views from components/VisitCounter and
// funnel clicks from here. No cookies; the API keeps a daily hash of IP + browser.

export type FunnelEvent = "cover" | "auth_open" | "episode" | "paywall";

export interface VisitBeacon {
  path: string;
  referrer?: string;
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_content?: string;
  /** The landing URL carried a Meta click id (the id itself is not sent). */
  fbclid?: boolean;
  lang?: string;
  event?: FunnelEvent;
  target?: string;
}

export function sendVisit(beacon: VisitBeacon): void {
  if (typeof window === "undefined" || navigator.webdriver || window.location.pathname.startsWith("/stats")) return;
  const payload = new Blob([JSON.stringify(beacon)], { type: "application/json" });
  if (!navigator.sendBeacon?.("/api/v", payload)) {
    fetch("/api/v", { method: "POST", body: payload, keepalive: true }).catch(() => {});
  }
}

/** A click on the way to paying; `target` says what it was about (slug, "slug/episode", reason). */
export function trackEvent(event: FunnelEvent, target = ""): void {
  if (typeof window === "undefined") return;
  sendVisit({ path: window.location.pathname, lang: document.documentElement.lang, event, target });
}
