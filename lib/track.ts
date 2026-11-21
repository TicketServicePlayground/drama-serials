// The site's own counter (backend/app/visits.py): page views from components/VisitCounter and
// funnel clicks from here. Each visit carries the browser's ad label (the utm_* of the last link
// it came by), so every row says itself where it is from; the server counts rows and merges nothing.
// The same label goes to the site's server in the cookie an_src, for sign-ups and payments.

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
const LABEL_KEY = "an_src";
const UTM = ["utm_source", "utm_medium", "utm_campaign", "utm_content"] as const;
type Utm = Partial<Record<(typeof UTM)[number], string>>;

/** The ad label of the last link this browser came by; a new link with utm_* replaces it. */
function adLabel(beacon: VisitBeacon): Utm {
  if (UTM.some((k) => beacon[k])) {
    const label = Object.fromEntries(UTM.map((k) => [k, beacon[k] ?? ""])) as Utm;
    try {
      localStorage.setItem(LABEL_KEY, JSON.stringify(label));
    } catch {
      // Storage blocked: only this visit has it.
    }
    return label;
  }
  try {
    const kept = JSON.parse(localStorage.getItem(LABEL_KEY) ?? "{}");
    return Object.fromEntries(UTM.map((k) => [k, typeof kept?.[k] === "string" ? kept[k] : ""])) as Utm;
  } catch {
    return {};
  }
}

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
    // Storage is blocked (private mode): rows without an id.
    return "";
  }
}

export function sendVisit(beacon: VisitBeacon): void {
  if (typeof window === "undefined" || navigator.webdriver || window.location.pathname.startsWith("/stats")) return;
  const cid = clientId();
  // The A/B group goes along only when it can stay the same (storage works).
  const ab = cid ? gateGroup() : "";
  const label = adLabel(beacon);
  // For the site's server: a sign-up or a payment made in this browser keeps the same label.
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${LABEL_KEY}=${encodeURIComponent(JSON.stringify({ ...label, ab, cid }))}; path=/; max-age=15552000; SameSite=Lax${secure}`;
  const payload = new Blob([JSON.stringify({ ...beacon, ...label, cid, ab })], { type: "application/json" });
  if (!navigator.sendBeacon?.("/api/v", payload)) {
    fetch("/api/v", { method: "POST", body: payload, keepalive: true }).catch(() => {});
  }
}

/** A click on the way to paying; `target` says what it was about (slug, "slug/episode", reason). */
export function trackEvent(event: FunnelEvent, target = ""): void {
  if (typeof window === "undefined") return;
  sendVisit({ path: window.location.pathname, lang: document.documentElement.lang, event, target });
}
