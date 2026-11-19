import { apiFetch, clientIp } from "@/lib/api";
import { getToken } from "@/lib/auth";
import { isVipSerial } from "@/lib/catalog";

/** Opens the provider's payment page for a product and returns where to send the payer. */
export async function POST(request: Request) {
  const token = await getToken();
  if (!token) return Response.json({ error: "unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => null);
  // Episodes of VIP series are not sold one by one.
  if (["episode", "series_day"].includes(body?.product) && typeof body?.slug === "string" && isVipSerial(body.slug)) {
    return Response.json({ error: "vip_only" }, { status: 400 });
  }
  const { status, data } = await apiFetch<{ id: string; invoice_url: string | null }>("/payments", {
    method: "POST",
    token,
    ip: clientIp(request),
    body: {
      method: body?.method,
      product: body?.product,
      slug: body?.slug ?? null,
      episode: body?.episode ?? null,
      locale: body?.locale,
      next: body?.next || null,
    },
  });
  if (status !== 200 || !data.invoice_url) {
    return Response.json({ error: data.error ?? "payment_unavailable" }, { status: status === 200 ? 502 : status });
  }
  return Response.json({ id: data.id, invoiceUrl: data.invoice_url });
}
