import { apiFetch, clientIp } from "@/lib/api";
import { getToken } from "@/lib/auth";
import { isVipSerial } from "@/lib/catalog";
import { isLocale } from "@/lib/i18n";

/** Signed video URL for a viewer with access; 402 without access, 404 while not uploaded. */
export async function GET(request: Request, { params }: { params: Promise<{ slug: string; episode: string }> }) {
  // Free episodes play without signing in; the API decides.
  const token = await getToken();
  const { slug, episode } = await params;
  // Audio track: the viewer's UI language; the API falls back when there is no such dub.
  const lang = new URL(request.url).searchParams.get("lang");
  const search = new URLSearchParams();
  if (isLocale(lang)) search.set("lang", lang);
  // VIP series play only with a pass; the API learns which ones they are from here.
  if (isVipSerial(slug)) search.set("vip_only", "true");
  const query = search.size ? `?${search}` : "";
  const { status, data } = await apiFetch<{ url: string; duration: number | null }>(
    `/episodes/${encodeURIComponent(slug)}/${encodeURIComponent(episode)}/play${query}`,
    { token, ip: clientIp(request) },
  );
  return Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
}
