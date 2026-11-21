// The site's own counter (backend/app/visits.py): page views from components/VisitCounter and
// funnel clicks from here. No cookies; a person is the browser's random id (clientId).

import { gateGroup } from "./ab";

export type FunnelEvent = "cover" | "auth_open" | "episode" | "email_gate" | "paywall";

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

const CLIENT_ID_KEY = "vid";

/** A random id kept in this browser: the counter tells people apart by it (and nothing else). */
export function clientId(): string {
  try {
    let id = localStorage.getItem(CLIENT_ID_KEY);
    if (!id || !/^[a-f0-9]{16,32}$/.test(id)) {
      id = Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, "0")).join("");
      localStorage.setItem(CLIENT_ID_KEY, id);
    }
    return id;
  } catch {
    // Storage is blocked (private mode): the daily hash on the server stands in.
    return "";
  }
}

export function sendVisit(beacon: VisitBeacon): void {
  if (typeof window === "undefined" || navigator.webdriver || window.location.pathname.startsWith("/stats")) return;
  const cid = clientId();
  // The A/B group goes along only when it can stay the same (storage works).
  const payload = new Blob([JSON.stringify({ ...beacon, cid, ab: cid ? gateGroup() : "" })], { type: "application/json" });
  if (!navigator.sendBeacon?.("/api/v", payload)) {
    fetch("/api/v", { method: "POST", body: payload, keepalive: true }).catch(() => {});
  }
}

/** A click on the way to paying; `target` says what it was about (slug, "slug/episode", reason). */
export function trackEvent(event: FunnelEvent, target = ""): void {
  if (typeof window === "undefined") return;
  sendVisit({ path: window.location.pathname, lang: document.documentElement.lang, event, target });
}
