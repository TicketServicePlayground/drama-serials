import { apiFetch } from "@/lib/api";
import { getToken } from "@/lib/auth";
import type { OfferState } from "@/lib/billing-types";

/** Plans and prices for the paywall; open without an account (sign-up happens at paying). */
export async function POST() {
  const { status, data } = await apiFetch<OfferState>("/offer", { method: "POST", token: await getToken() });
  return Response.json(data, { status });
}
