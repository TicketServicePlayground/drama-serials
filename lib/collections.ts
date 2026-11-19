// Favourites ("My List") and likes live in plain cookies, readable by the server for the
// first render and written by the browser. They are preference cookies: written only after
// the visitor accepted them in the cookie banner (see CookieBanner, Cookie Policy).

export const FAVORITES_COOKIE = "ds_favs";
export const LIKES_COOKIE = "ds_likes";
export const CONSENT_COOKIE = "ds_consent";
export const CONSENT_EVENT = "ds-consent";
const MAX_AGE = 60 * 60 * 24 * 365;

export type Consent = "all" | "necessary";

export function parseList(value: string | undefined): string[] {
  if (!value) return [];
  return decodeURIComponent(value).split(",").filter(Boolean);
}

export function readConsent(): Consent | null {
  const match = document.cookie.match(/(?:^|; )ds_consent=(all|necessary)/);
  return match ? (match[1] as Consent) : null;
}

export function writeConsent(consent: Consent): void {
  document.cookie = `${CONSENT_COOKIE}=${consent}; Path=/; Max-Age=${MAX_AGE}; SameSite=Lax`;
  window.dispatchEvent(new CustomEvent(CONSENT_EVENT, { detail: consent }));
}

export function writeListCookie(name: string, items: string[]): void {
  if (readConsent() !== "all") return;
  document.cookie = `${name}=${encodeURIComponent(items.join(","))}; Path=/; Max-Age=${MAX_AGE}; SameSite=Lax`;
}

/** "Necessary only": preference cookies already set are removed. */
export function clearPreferenceCookies(): void {
  for (const name of [FAVORITES_COOKIE, LIKES_COOKIE]) {
    document.cookie = `${name}=; Path=/; Max-Age=0; SameSite=Lax`;
  }
}
