import type { NextRequest } from "next/server";
import { apiFetch, clientIp } from "@/lib/api";
import { getToken } from "@/lib/auth";

/** A page view or funnel click (lib/track.ts). The IP and browser are taken from the request here. */
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const field = (key: string, max: number) => (typeof body?.[key] === "string" ? (body[key] as string).slice(0, max) : "");
  const ip = clientIp(request);
  await apiFetch("/visits", {
    method: "POST",
    token: await getToken(),
    body: {
      path: field("path", 300),
      referrer: field("referrer", 500),
      utm_source: field("utm_source", 80),
      utm_medium: field("utm_medium", 80),
      utm_campaign: field("utm_campaign", 150),
      utm_content: field("utm_content", 150),
      fbclid: body?.fbclid === true,
      // Country of the IP from the proxy in front (Cloudflare or nginx GeoIP); the IP is not kept.
      country: (request.headers.get("cf-ipcountry") ?? request.headers.get("x-country") ?? "").slice(0, 2),
      lang: field("lang", 8),
      event: field("event", 20),
      target: field("target", 80),
      cid: field("cid", 32),
      ab: field("ab", 16),
      ip,
      ua: request.headers.get("user-agent") ?? "",
    },
  });
  return new Response(null, { status: 204 });
}
