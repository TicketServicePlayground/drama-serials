import { findSerial } from "@/lib/catalog";
import { isLocale } from "@/lib/i18n";

/** A series title in a language, for the API's reminder emails (the catalog lives here). */
export function GET(request: Request) {
  const url = new URL(request.url);
  const lang = url.searchParams.get("lang");
  const serial = findSerial(url.searchParams.get("slug") ?? "", isLocale(lang) ? lang : "en");
  return serial ? Response.json({ title: serial.title }) : Response.json({ error: "not_found" }, { status: 404 });
}
