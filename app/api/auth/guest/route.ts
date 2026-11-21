import { visitorCountry, browserLabel, apiFetch, clientIp, type Account } from "@/lib/api";
import { startSession } from "@/lib/auth";

/** QRIS / SBP without an email: a guest account, kept only by the session cookie. */
export async function POST(request: Request) {
  const { status, data } = await apiFetch<{ token: string; user: Account }>("/auth/guest", {
    method: "POST",
    ip: clientIp(request),
    country: visitorCountry(request),
    label: browserLabel(request),
  });
  if (status !== 200) return Response.json({ error: data.error ?? "generic" }, { status });
  await startSession(data.token);
  return Response.json({ ok: true });
}
