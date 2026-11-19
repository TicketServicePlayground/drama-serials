"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { sendVisit } from "@/lib/track";

/**
 * The site's own visit counter: one beacon per page shown, no cookies. The API keeps a daily
 * hash of IP + browser, not the IP (see backend/app/visits.py).
 */
export function VisitCounter() {
  const pathname = usePathname();
  const first = useRef(true);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    sendVisit({
      path: pathname,
      // document.referrer stays the same across client-side navigation: only the first view has a source.
      referrer: first.current ? document.referrer : "",
      utm_source: params.get("utm_source") ?? "",
      utm_medium: params.get("utm_medium") ?? "",
      utm_campaign: params.get("utm_campaign") ?? "",
      utm_content: params.get("utm_content") ?? "",
      fbclid: params.has("fbclid"),
      lang: document.documentElement.lang,
    });
    first.current = false;
  }, [pathname]);

  return null;
}
