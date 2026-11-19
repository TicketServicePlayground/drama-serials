"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { clearPreferenceCookies, readConsent, writeConsent, type Consent } from "@/lib/collections";
import { getDictionary, withLocale, type Locale } from "@/lib/i18n";

/**
 * Compact cookie notice pinned to the bottom: above the mobile tab bar, a small card in the
 * corner on desktop. Shown until the visitor picks an option.
 */
export function CookieBanner({ locale }: { locale: Locale }) {
  const t = getDictionary(locale);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    // Read after mount: the server cannot know, and the page must not jump on hydration.
    setOpen(readConsent() === null);
  }, []);

  if (!open) return null;

  const choose = (consent: Consent) => {
    if (consent === "necessary") clearPreferenceCookies();
    writeConsent(consent);
    setOpen(false);
  };

  return (
    <div
      role="region"
      aria-label={t.cookies.more}
      className="fixed inset-x-2 bottom-[calc(4.25rem+env(safe-area-inset-bottom))] z-30 rounded-xl border border-border bg-overlay/95 p-3 text-xs text-overlay-foreground shadow-2xl backdrop-blur md:inset-x-auto md:right-4 md:bottom-4 md:max-w-sm"
    >
      <p className="leading-5 text-muted">
        {t.cookies.text}{" "}
        <Link href={withLocale("/legal/cookies", locale)} className="text-foreground underline-offset-2 hover:underline">
          {t.cookies.more}
        </Link>
      </p>
      <div className="mt-2.5 flex gap-2">
        <button
          type="button"
          onClick={() => choose("all")}
          className="h-8 flex-1 cursor-pointer rounded-lg bg-accent px-3 font-semibold text-accent-foreground outline-none focus-visible:ring-2 focus-visible:ring-focus"
        >
          {t.cookies.accept}
        </button>
        <button
          type="button"
          onClick={() => choose("necessary")}
          className="h-8 flex-1 cursor-pointer rounded-lg bg-surface-secondary px-3 font-medium text-foreground outline-none focus-visible:ring-2 focus-visible:ring-focus"
        >
          {t.cookies.necessary}
        </button>
      </div>
    </div>
  );
}
