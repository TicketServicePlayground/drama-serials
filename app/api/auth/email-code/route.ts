import { apiFetch, clientIp } from "@/lib/api";

/** The email offer, step one: a code to the address (backend /auth/email-code). */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const { status, data } = await apiFetch<{ challenge: string }>("/auth/email-code", {
    method: "POST",
    ip: clientIp(request),
    body: { email: body?.email ?? "", locale: body?.locale ?? "en" },
  });
  if (status !== 200) return Response.json({ error: (data as { error?: string }).error ?? "generic" }, { status });
  return Response.json({ challenge: data.challenge });
}
