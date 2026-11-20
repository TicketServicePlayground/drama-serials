import { apiFetch } from "@/lib/api";
import { getToken } from "@/lib/auth";

/** A token for a sign-in link that carries this session to another browser. */
export async function POST() {
  const token = await getToken();
  if (!token) return Response.json({ error: "unauthorized" }, { status: 401 });
  const { status, data } = await apiFetch<{ token: string }>("/auth/transfer-link", { method: "POST", token });
  if (status !== 200 || !data.token) return Response.json({ error: data.error ?? "generic" }, { status: status === 200 ? 502 : status });
  return Response.json({ token: data.token });
}
