import { apiFetch, clientIp, type Account } from "@/lib/api";
import { startSession } from "@/lib/auth";

/** Opens a sign-in link made in another browser: takes over that session, then goes on. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const token = url.searchParams.get("t") ?? "";
  const next = url.searchParams.get("next") ?? "/profile";
  const target = next.startsWith("/") && !next.startsWith("//") ? next : "/profile";
  if (token) {
    const { status, data } = await apiFetch<{ token: string; user: Account }>("/auth/transfer", {
      method: "POST",
      ip: clientIp(request),
      body: { token },
    });
    if (status === 200 && data.token) await startSession(data.token);
  }
  // A relative Location: behind the proxy this app does not know its public host.
  return new Response(null, { status: 303, headers: { Location: target } });
}
