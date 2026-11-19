import { apiFetch, clientIp, type Account } from "@/lib/api";
import { getToken } from "@/lib/auth";

/** Exchanges VIP points for VIP days (backend/app/points.py). */
export async function POST(request: Request) {
  const token = await getToken();
  if (!token) return Response.json({ error: "unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => null);
  const days = Number.isInteger(body?.days) ? body.days : 1;
  const { status, data } = await apiFetch<{ balance: number; account: Account }>("/points/redeem", {
    method: "POST",
    token,
    ip: clientIp(request),
    body: { days },
  });
  return Response.json(data, { status });
}
