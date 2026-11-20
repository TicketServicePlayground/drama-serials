"use client";

import { useState } from "react";
import { getDictionary, type Locale } from "@/lib/i18n";

/**
 * A sign-in link to open the site in another browser with the same account: a purchase made in
 * Instagram's or Facebook's browser shows up in Safari or Chrome too.
 */
export function BrowserTransfer({ locale, next = "/profile", className = "" }: {
  locale: Locale;
  /** Where the link lands after signing in. */
  next?: string;
  className?: string;
}) {
  const t = getDictionary(locale).transfer;
  const [link, setLink] = useState<string>();
  const [state, setState] = useState<"idle" | "busy" | "copied" | "failed">("idle");

  async function make() {
    setState("busy");
    try {
      const response = await fetch("/api/auth/transfer-link", { method: "POST" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.token) throw new Error();
      const url = `${window.location.origin}/api/auth/transfer?${new URLSearchParams({ t: data.token, next })}`;
      setLink(url);
      try {
        await navigator.clipboard.writeText(url);
        setState("copied");
      } catch {
        // In-app browsers often block the clipboard: the link stays on screen to copy by hand.
        setState("idle");
      }
    } catch {
      setState("failed");
    }
  }

  return (
    <section className={`rounded-2xl bg-surface p-4 text-left ${className}`}>
      <p className="font-semibold">{t.title}</p>
      <p className="mt-1 text-sm leading-6 text-muted">{t.text}</p>
      <button
        type="button"
        onClick={make}
        disabled={state === "busy"}
        className="mt-3 h-10 w-full cursor-pointer rounded-xl bg-surface-secondary px-4 text-sm font-semibold text-foreground outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-focus disabled:opacity-60"
      >
        {state === "copied" ? t.copied : t.button}
      </button>
      {link && (
        <input
          readOnly
          value={link}
          onFocus={(event) => event.target.select()}
          aria-label={t.button}
          className="mt-2 w-full rounded-lg border border-border bg-surface-secondary px-2 py-1.5 text-xs text-muted outline-none"
        />
      )}
      {state === "failed" && <p role="alert" className="mt-2 text-sm text-danger">{t.failed}</p>}
      <p className="mt-2 text-xs text-muted">{t.note}</p>
    </section>
  );
}
