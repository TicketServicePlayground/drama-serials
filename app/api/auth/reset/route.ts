import { apiFetch, clientIp, type Account } from "@/lib/api";
import { startSession } from "@/lib/auth";

/** Sets the new password from an emailed link and signs in. */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const { status, data } = await apiFetch<{ token: string; user: Account }>("/auth/reset", {
    method: "POST",
    ip: clientIp(request),
    body: { token: body?.token ?? "", password: body?.password ?? "" },
  });
  if (status !== 200) return Response.json({ error: data.error ?? "generic" }, { status });
  await startSession(data.token);
  return Response.json({ email: data.user.email });
}
