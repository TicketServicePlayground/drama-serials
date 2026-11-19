import { apiFetch, clientIp, type Account } from "@/lib/api";
import { startSession } from "@/lib/auth";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const { status, data } = await apiFetch<{ token: string; user: Account }>("/auth/login", {
    method: "POST",
    ip: clientIp(request),
    body: { email: body?.email ?? "", password: body?.password ?? "" },
  });
  if (status !== 200) return Response.json({ error: data.error ?? "generic" }, { status });
  await startSession(data.token);
  return Response.json({ email: data.user.email });
}
