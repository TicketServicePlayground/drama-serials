import { visitorCountry, browserLabel, apiFetch, clientIp, type Account } from "@/lib/api";
import { startSession } from "@/lib/auth";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const { status, data } = await apiFetch<{ token: string; user: Account }>("/auth/register", {
    method: "POST",
    ip: clientIp(request),
    country: visitorCountry(request),
    label: browserLabel(request),
    body: { email: body?.email ?? "", password: body?.password ?? "", accept_terms: body?.accept_terms === true },
  });
  if (status !== 200) return Response.json({ error: data.error ?? "generic" }, { status });
  await startSession(data.token);
  return Response.json({ email: data.user.email });
}
