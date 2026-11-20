import "server-only";
import type { Locale } from "./i18n";

/**
 * Rough prices in the visitor's currency next to the rupiah ones. Payments stay in IDR (the bank
 * converts), so this is only a hint: one public rate table a day is plenty.
 */

const EURO = ["AT", "BE", "CY", "DE", "EE", "ES", "FI", "FR", "GR", "HR", "IE", "IT", "LT", "LU", "LV", "MT", "NL", "PT", "SK", "SI"];

const BY_COUNTRY: Record<string, string> = {
  ...Object.fromEntries(EURO.map((c) => [c, "EUR"])),
  US: "USD", GB: "GBP", CA: "CAD", AU: "AUD", NZ: "NZD", IE: "EUR",
  RU: "RUB", UA: "UAH", BY: "BYN", KZ: "KZT", UZ: "UZS", KG: "KGS", TJ: "TJS", AM: "AMD", GE: "GEL", AZ: "AZN", MD: "MDL",
  PH: "PHP", MY: "MYR", SG: "SGD", TH: "THB", VN: "VND", IN: "INR", JP: "JPY", KR: "KRW", CN: "CNY", HK: "HKD", TW: "TWD",
  AE: "AED", SA: "SAR", TR: "TRY", IL: "ILS", PL: "PLN", CZ: "CZK", HU: "HUF", RO: "RON", BG: "BGN", RS: "RSD",
  SE: "SEK", NO: "NOK", DK: "DKK", CH: "CHF", MX: "MXN", BR: "BRL", AR: "ARS", CL: "CLP", CO: "COP", PE: "PEN",
  ZA: "ZAR", NG: "NGN", EG: "EGP", PK: "PKR", BD: "BDT",
};

// No country from the proxy: guess by the language. Indonesian visitors see rupiah only.
const BY_LOCALE: Record<Locale, string | null> = { en: "USD", ru: "RUB", es: "USD", id: null };

const RATES_URL = "https://open.er-api.com/v6/latest/IDR";
let last: { at: number; rates: Record<string, number> } | null = null;

async function idrRates(): Promise<Record<string, number> | null> {
  if (last && Date.now() - last.at < 12 * 3600_000) return last.rates;
  try {
    const response = await fetch(RATES_URL, { next: { revalidate: 43_200 }, signal: AbortSignal.timeout(4000) });
    const data = await response.json();
    if (data?.result === "success" && data.rates) last = { at: Date.now(), rates: data.rates };
  } catch {
    // Keep the previous table if there is one; without it the paywall just shows rupiah.
  }
  return last?.rates ?? null;
}

export interface Approx {
  currency: string;
  /** One rupiah in that currency. */
  rate: number;
}

export async function approxFor(country: string, locale: Locale): Promise<Approx | null> {
  if (country.toUpperCase() === "ID") return null;
  const currency = BY_COUNTRY[country.toUpperCase()] ?? BY_LOCALE[locale];
  if (!currency || currency === "IDR") return null;
  const rate = (await idrRates())?.[currency];
  return rate ? { currency, rate } : null;
}
