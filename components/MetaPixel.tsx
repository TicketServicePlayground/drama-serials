"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

/**
 * Meta Pixel, loaded on every page view (Cookie Policy §3; the banner covers only our own cookies).
 * The id comes from META_PIXEL_ID on the server, so it can change without a rebuild.
 */
export function MetaPixel({ pixelId }: { pixelId: string }) {
  const pathname = usePathname();
  const loaded = useRef(false);

  useEffect(() => {
    const load = () => {
      if (loaded.current || window.fbq) return;
      loaded.current = true;
      // Meta's base code, unminified: calls queue up until fbevents.js arrives and sets callMethod.
      type Stub = ((...args: unknown[]) => void) & {
        callMethod?: (...args: unknown[]) => void;
        queue: unknown[];
        push: unknown;
        loaded: boolean;
        version: string;
      };
      const stub = function (...args: unknown[]) {
        if (stub.callMethod) stub.callMethod.apply(stub, args);
        else stub.queue.push(args);
      } as Stub;
      stub.push = stub;
      stub.loaded = true;
      stub.version = "2.0";
      stub.queue = [];
      const w = window as unknown as { fbq: Stub; _fbq?: Stub };
      w.fbq = stub;
      w._fbq ??= stub;
      const script = document.createElement("script");
      script.async = true;
      script.src = "https://connect.facebook.net/en_US/fbevents.js";
      document.head.appendChild(script);
      window.fbq!("init", pixelId);
      window.fbq!("track", "PageView");
      for (const [event, params, eventID] of window.dsPixelQueue?.splice(0) ?? []) {
        window.fbq!("track", event, params, eventID ? { eventID } : undefined);
      }
    };
    load();
  }, [pixelId]);

  // Client-side navigation: the first PageView is sent on load above.
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (window.fbq && !pathname.startsWith("/stats")) window.fbq("track", "PageView");
  }, [pathname]);

  return null;
}
