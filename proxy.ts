import { NextResponse, type NextRequest } from "next/server";
import { DEFAULT_LOCALE, isLocale, LOCALE_HEADER, LOCALE_PARAM, matchAcceptLanguage } from "@/lib/i18n";

/**
 * Resolves the UI language and hands it to Server Components as a header:
 * `?lang=en|id|es` wins, otherwise the browser's Accept-Language, otherwise English.
 */
export function proxy(request: NextRequest) {
  const param = request.nextUrl.searchParams.get(LOCALE_PARAM);
  const locale = isLocale(param)
    ? param
    : matchAcceptLanguage(request.headers.get("accept-language")) ?? DEFAULT_LOCALE;

  const headers = new Headers(request.headers);
  headers.set(LOCALE_HEADER, locale);
  return NextResponse.next({ request: { headers } });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|api/|favicon.ico|.*\\..*).*)"],
};
