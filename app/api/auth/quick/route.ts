import { apiFetch, clientIp, type Account } from "@/lib/api";
import { startSession } from "@/lib/auth";

/** Sign-up at the paywall with only an email: the password is emailed, the visitor is signed in. */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const { status, data } = await apiFetch<{ token: string; user: Account }>("/auth/quick", {
    method: "POST",
    ip: clientIp(request),
    body: { email: body?.email ?? "", locale: body?.locale ?? "en" },
  });
  if (status !== 200) return Response.json({ error: data.error ?? "generic" }, { status });
  await startSession(data.token);
  return Response.json({ email: data.user.email });
}
