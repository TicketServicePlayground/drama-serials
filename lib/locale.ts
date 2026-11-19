import "server-only";
import { headers } from "next/headers";
import { DEFAULT_LOCALE, isLocale, type Locale } from "./i18n";
import { LOCALE_HEADER } from "./i18n";

/** Locale resolved by proxy.ts for the current request. */
export async function getLocale(): Promise<Locale> {
  const value = (await headers()).get(LOCALE_HEADER);
  return isLocale(value) ? value : DEFAULT_LOCALE;
}
