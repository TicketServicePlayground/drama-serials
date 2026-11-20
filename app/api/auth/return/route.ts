import { apiFetch, clientIp, type Account } from "@/lib/api";
import { startSession } from "@/lib/auth";

/**
 * The provider's return link of a guest payment carries a signed key (k): sign that guest in and
 * go on to the payment page without it. A guest who paid from Instagram's browser and came back
 * in Safari sees the purchase there too.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const payment = url.searchParams.get("payment") ?? "";
  const key = url.searchParams.get("k") ?? "";
  const next = url.searchParams.get("next") ?? "/";
  // Only paths on this site, never another host.
  const target = next.startsWith("/") && !next.startsWith("//") ? next : "/";
  if (payment && key) {
    const { status, data } = await apiFetch<{ token: string; user: Account }>("/auth/return", {
      method: "POST",
      ip: clientIp(request),
      body: { payment_id: payment, key },
    });
    if (status === 200 && data.token) await startSession(data.token);
  }
  // A relative Location: behind the proxy this app does not know its public host.
  return new Response(null, { status: 303, headers: { Location: target } });
}
