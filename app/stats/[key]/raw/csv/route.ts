import { API_URL } from "@/lib/api";

// The whole period of one table as a CSV file, straight from the API (GET /raw?format=csv).
export async function GET(request: Request, { params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const query = new URL(request.url).searchParams;
  const qs = new URLSearchParams({ key, format: "csv" });
  for (const name of ["table", "from", "to"]) {
    const value = query.get(name);
    if (value) qs.set(name, value.slice(0, 40));
  }
  try {
    const response = await fetch(`${API_URL}/api/v1/raw?${qs}`, { cache: "no-store" });
    if (!response.ok) return new Response("not found", { status: response.status });
    return new Response(response.body, {
      headers: {
        "Content-Type": response.headers.get("content-type") ?? "text/csv; charset=utf-8",
        "Content-Disposition": response.headers.get("content-disposition") ?? "attachment",
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return new Response("unavailable", { status: 503 });
  }
}
