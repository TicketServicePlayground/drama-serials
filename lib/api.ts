import "server-only";

// The Python API lives next to this app (docker network `api:8000`); browsers never call it.
export const API_URL = process.env.API_URL || "http://localhost:8020";

export type { AccountView as Account } from "./billing-types";

export interface ApiResult<T> {
  status: number;
  data: T & { error?: string };
}

/** The visitor's country (ISO code) from nginx GeoIP or Cloudflare; prices depend on it in some countries. */
export function visitorCountry(request: Request): string {
  return (request.headers.get("cf-ipcountry") ?? request.headers.get("x-country") ?? "").slice(0, 2).toUpperCase();
}

/** The visitor's IP as nginx saw it (X-Real-IP), for the API's logs. */
export function clientIp(request: Request): string {
  return request.headers.get("x-real-ip") ?? request.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "";
}

export async function apiFetch<T>(
  path: string,
  { method = "GET", token, body, ip, country }: {
    method?: string;
    token?: string | null;
    body?: unknown;
    /** The visitor's IP (clientIp): the API logs it with sign-ins and payments. */
    ip?: string;
    /** The visitor's country (visitorCountry): the API prices by it. */
    country?: string;
  } = {},
): Promise<ApiResult<T>> {
  try {
    const response = await fetch(`${API_URL}/api/v1${path}`, {
      method,
      headers: {
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(ip ? { "X-Forwarded-For": ip } : {}),
        ...(country ? { "X-Country": country } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      cache: "no-store",
    });
    const data = (await response.json().catch(() => ({}))) as T & { error?: string };
    return { status: response.status, data };
  } catch {
    return { status: 503, data: { error: "unavailable" } as T & { error?: string } };
  }
}
