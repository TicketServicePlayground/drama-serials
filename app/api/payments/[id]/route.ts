import { apiFetch } from "@/lib/api";
import { getToken } from "@/lib/auth";
import type { PaymentState } from "@/lib/billing-types";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const token = await getToken();
  if (!token) return Response.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const { status, data } = await apiFetch<PaymentState>(`/payments/${encodeURIComponent(id)}`, { token });
  return Response.json(data, { status });
}
