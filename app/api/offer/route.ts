import { apiFetch, visitorCountry } from "@/lib/api";
import { getToken } from "@/lib/auth";
import type { OfferState } from "@/lib/billing-types";
import { approxFor } from "@/lib/fx";
import { isLocale } from "@/lib/i18n";

/** Plans and prices for the paywall; open without an account (sign-up happens at paying). */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  // Country of the IP from nginx GeoIP (or Cloudflare): prices for it, roughly in its currency too.
  const country = visitorCountry(request);
  const { status, data } = await apiFetch<OfferState>("/offer", { method: "POST", token: await getToken(), country });
  if (status !== 200) return Response.json(data, { status });
  const locale = isLocale(body?.locale) ? body.locale : "en";
  return Response.json({ ...data, approx: await approxFor(country, locale), country });
}
