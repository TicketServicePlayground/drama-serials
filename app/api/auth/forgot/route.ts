import { apiFetch, clientIp } from "@/lib/api";

/** Emails a password reset link; the same answer whether or not the account exists. */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const { status, data } = await apiFetch<{ ok: boolean }>("/auth/forgot", {
    method: "POST",
    ip: clientIp(request),
    body: { email: body?.email ?? "", locale: body?.locale ?? "en" },
  });
  if (status !== 200) return Response.json({ error: data.error ?? "generic" }, { status });
  return Response.json({ ok: true });
}
