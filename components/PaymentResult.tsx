"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { BrowserTransfer } from "./BrowserTransfer";
import { Spinner } from "@heroui/react";
import type { PaymentState } from "@/lib/billing-types";
import { getDictionary, withLocale, type Locale } from "@/lib/i18n";
import { trackPurchaseOnce } from "@/lib/pixel";
import { CrownIcon, LockIcon } from "./icons";
import { LocalDate } from "./LocalDate";

// Xendit usually confirms QRIS within seconds; keep asking for a few minutes, then slow down.
const FAST_POLL_MS = 2500;
const SLOW_POLL_MS = 10000;
const FAST_PHASE_MS = 3 * 60 * 1000;

export function PaymentResult({ id, locale }: { id: string; locale: Locale }) {
  const t = getDictionary(locale);
  const [state, setState] = useState<PaymentState | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const started = Date.now();
    async function poll() {
      try {
        const response = await fetch(`/api/payments/${id}`, { cache: "no-store" });
        if (response.status === 404) {
          setMissing(true);
          return;
        }
        if (response.ok) {
          const data: PaymentState = await response.json();
          if (stopped) return;
          setState(data);
          if (data.status === "paid") trackPurchaseOnce(id, data.amount, data.currency || "IDR", data.product, data.slug);
          if (data.status !== "pending") return;
        }
      } catch {
        // Network hiccup: try again on the next tick.
      }
      if (!stopped) timer = setTimeout(poll, Date.now() - started < FAST_PHASE_MS ? FAST_POLL_MS : SLOW_POLL_MS);
    }
    poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [id]);

  // Back to the series; a single bought episode starts playing right away.
  const nextHref = withLocale(
    state?.next ? `/series/${state.next}${state.product === "episode" && state.episode ? `?play=${state.episode}` : ""}` : "/",
    locale,
  );

  if (missing) return <p className="mt-16 text-center text-muted">{t.payment.notFound}</p>;

  if (!state || state.status === "pending") {
    return (
      <div className="mt-12 flex flex-col items-center gap-4 text-center" aria-live="polite">
        <Spinner size="lg" />
        <h1 className="text-xl font-bold">{t.payment.pendingTitle}</h1>
        <p className="text-sm leading-6 text-muted">{t.payment.pendingText}</p>
        {state?.invoice_url && (
          <a href={state.invoice_url} className="text-sm text-accent underline-offset-4 hover:underline">
            {t.payment.backToPayment}
          </a>
        )}
      </div>
    );
  }

  if (state.status === "paid") {
    return (
      <div className="mt-12 flex flex-col items-center gap-4 text-center" aria-live="polite">
        <span className="flex size-16 items-center justify-center rounded-full bg-gold/15 text-gold">
          <CrownIcon className="size-8" />
        </span>
        <h1 className="text-2xl font-bold">{t.payment.paidTitle}</h1>
        {(() => {
          // How long the access bought here lasts: VIP for every series, or the one-series pass.
          const until =
            state.product === "series_day"
              ? state.account.series_passes?.find((p) => p.slug === state.next)?.until
              : state.product !== "episode"
                ? state.account.access_until
                : null;
          return until ? (
            <p className="text-sm leading-6 text-muted">
              {t.payment.paidText} <LocalDate iso={until} locale={locale} />
            </p>
          ) : null;
        })()}
        <Link
          href={nextHref}
          className="mt-2 rounded-xl bg-accent px-6 py-3 font-medium text-accent-foreground outline-none focus-visible:ring-2 focus-visible:ring-focus"
        >
          {t.payment.startWatching}
        </Link>
        <BrowserTransfer locale={locale} next={nextHref} className="mt-6 w-full" />
      </div>
    );
  }

  return (
    <div className="mt-12 flex flex-col items-center gap-4 text-center" aria-live="polite">
      <span className="flex size-16 items-center justify-center rounded-full bg-danger/15 text-danger">
        <LockIcon className="size-8" />
      </span>
      <h1 className="text-xl font-bold">{t.payment.failedTitle}</h1>
      <p className="text-sm leading-6 text-muted">{t.payment.failedText}</p>
      <Link
        href={withLocale(state.next ? `/series/${state.next}` : "/vip", locale)}
        className="mt-2 rounded-xl bg-accent px-6 py-3 font-medium text-accent-foreground outline-none focus-visible:ring-2 focus-visible:ring-focus"
      >
        {t.payment.tryAgain}
      </Link>
    </div>
  );
}
