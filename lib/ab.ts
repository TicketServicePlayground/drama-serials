// The A/B test at the first locked episode (backend: users.ab, visits.ab, /funnel by_ab):
//   "paywall" - the plans at once, as before;
//   "email"   - first, once, an offer: leave an email for a few more free episodes (EmailGate),
//               then the plans at the episode after those.
// The group is fixed per browser and goes with every visit beacon (lib/track.ts).

export type GateGroup = "paywall" | "email";

const KEY = "ab_gate";
const SEEN = "email_gate_seen";

export function gateGroup(): GateGroup {
  if (typeof window === "undefined") return "paywall";
  try {
    const kept = localStorage.getItem(KEY);
    if (kept === "paywall" || kept === "email") return kept;
    const group: GateGroup = crypto.getRandomValues(new Uint8Array(1))[0] % 2 === 0 ? "paywall" : "email";
    localStorage.setItem(KEY, group);
    return group;
  } catch {
    // Storage blocked: no stable group, so stay out of the test (plans as before, not counted).
    return "paywall";
  }
}

/** In the test at all: storage works, so the group stays the same on the next visit. */
export function gateGroupKept(): GateGroup | "" {
  try {
    return (localStorage.getItem(KEY) as GateGroup | null) ?? "";
  } catch {
    return "";
  }
}

/** The email offer is shown once per browser; after that the plans as usual. */
export function emailOfferSeen(): boolean {
  try {
    return localStorage.getItem(SEEN) === "1";
  } catch {
    return true;
  }
}

export function markEmailOfferSeen(): void {
  try {
    localStorage.setItem(SEEN, "1");
  } catch {
    // Storage blocked: it may show again, harmless.
  }
}
