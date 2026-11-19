"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Button, Spinner } from "@heroui/react";
import { formatIdr, type OfferState, type PayMethod, type PriceView, type ProductId } from "@/lib/billing-types";
import { getDictionary, withLocale, type Locale } from "@/lib/i18n";
import { trackPixel } from "@/lib/pixel";
import { trackEvent } from "@/lib/track";
import { CrownIcon } from "./icons";

export interface PaywallTarget {
  slug: string;
  /** Present when the paywall was opened from an episode: offers buying just that one. */
  episode?: number;
  /** A VIP series: VIP passes only. */
  vipOnly?: boolean;
  /** The viewer just finished the series: offer VIP for the rest. */
  upsell?: boolean;
}

/** A series that can be bought for a day (not VIP-only). */
export interface SeriesOption {
  slug: string;
  title: string;
}

const PAY_LABEL: Record<PayMethod, (t: ReturnType<typeof getDictionary>) => string> = {
  QRIS: (t) => t.paywall.payQris,
  CREDIT_CARD: (t) => t.paywall.payCard,
  SBP: (t) => t.paywall.paySbp,
};

/** The last second of the launch price, as a date in Jakarta time: "31.12.2026" style. */
function launchDate(endsAt: string, locale: Locale): string {
  return new Intl.DateTimeFormat(locale, { timeZone: "Asia/Jakarta", day: "numeric", month: "long", year: "numeric" })
    .format(new Date(Date.parse(endsAt) - 1000));
}

/**
 * Plans in this order: one series for a day (the series the viewer is on, or any other), VIP
 * passes at the launch price with the regular one crossed out and the end date, a single episode.
 * The prices shown are the ones that will be charged.
 */
export function PaywallPanel({ locale, target, series, signedIn = true, onSignIn }: {
  locale: Locale;
  target?: PaywallTarget;
  /** Choices for "one series for a day". */
  series: SeriesOption[];
  /** Signed out: an email field; paying creates the account and emails its password. */
  signedIn?: boolean;
  /** The email already has an account: open sign-in. */
  onSignIn?: () => void;
}) {
  const t = getDictionary(locale);
  const [offer, setOffer] = useState<OfferState | null>(null);
  const [failed, setFailed] = useState(false);
  const canBuySeries = !target?.vipOnly && !target?.upsell && series.length > 0;
  const [plan, setPlan] = useState<ProductId>(canBuySeries && target ? "series_day" : "week");
  const [seriesSlug, setSeriesSlug] = useState(
    series.find((s) => s.slug === target?.slug)?.slug ?? series[0]?.slug ?? "",
  );
  const [pending, setPending] = useState<PayMethod | null>(null);
  const [error, setError] = useState<string>();
  const [email, setEmail] = useState("");
  const [emailTaken, setEmailTaken] = useState(false);
  // Signed up here already (a retry after a failed payment start): no second sign-up.
  const [joined, setJoined] = useState(signedIn);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/offer", { method: "POST" });
      if (!response.ok) throw new Error();
      setOffer(await response.json());
    } catch {
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    trackEvent("paywall", target?.slug ?? "vip");
  }, [target?.slug]);

  async function signUp(): Promise<boolean> {
    const response = await fetch("/api/auth/quick", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, locale }),
    });
    const data = await response.json().catch(() => ({}));
    if (response.ok) {
      trackPixel("CompleteRegistration");
      setJoined(true);
      return true;
    }
    if (data.error === "email_taken") setEmailTaken(true);
    setError(data.error === "email_taken" ? t.paywall.emailTaken : (t.auth.errors[data.error] ?? t.paywall.error));
    return false;
  }

  async function pay(method: PayMethod) {
    setPending(method);
    setError(undefined);
    setEmailTaken(false);
    if (!joined) {
      if (!/^\S+@\S+\.\S+$/.test(email.trim())) {
        setError(t.auth.emailInvalid);
        setPending(null);
        return;
      }
      try {
        if (!(await signUp())) {
          setPending(null);
          return;
        }
      } catch {
        setError(t.auth.errors.network);
        setPending(null);
        return;
      }
    }
    const slug = plan === "series_day" ? seriesSlug : plan === "episode" ? target?.slug : undefined;
    try {
      const response = await fetch("/api/payments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          method,
          product: plan,
          slug,
          episode: plan === "episode" ? target?.episode : undefined,
          locale,
          next: plan === "series_day" ? seriesSlug : target?.slug,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.invoiceUrl) throw new Error(data.error);
      const chosen = offer?.products.find((p) => p.id === plan);
      if (chosen) trackPixel("InitiateCheckout", { value: chosen.price, currency: "IDR", content_name: plan });
      // Leaving for the provider; keep the button spinning until the page unloads.
      window.location.assign(data.invoiceUrl);
    } catch {
      setError(t.paywall.error);
      setPending(null);
    }
  }

  if (failed) return <p className="py-6 text-center text-sm text-danger">{t.paywall.unavailable}</p>;
  if (!offer) {
    return (
      <div className="flex justify-center py-10">
        <Spinner />
      </div>
    );
  }

  const shown = (p: PriceView) =>
    p.kind === "vip" ||
    (p.kind === "series" && canBuySeries) ||
    (p.kind === "episode" && Boolean(target?.episode) && !target?.vipOnly && !target?.upsell);
  const plans = offer.products.filter(shown);
  const labels: Record<ProductId, string> = {
    series_day: t.paywall.seriesDayPlan,
    episode: t.paywall.episodePlan,
    week: t.paywall.weekPlan,
    month: t.paywall.monthPlan,
    year: t.paywall.yearPlan,
  };
  const chosenKind = offer.products.find((p) => p.id === plan)?.kind;
  const launch = offer.launch.active && offer.launch.ends_at ? offer.launch : null;
  // In the API's order (QRIS, cards, SBP); SBP is for Russian speakers only.
  const methods = offer.methods.filter((m) => m !== "SBP" || locale === "ru");

  return (
    <div className="flex flex-col gap-4">
      {target?.upsell && (
        <p className="flex items-center gap-2 rounded-xl bg-gold-soft px-3 py-2 text-sm font-semibold text-gold">
          <CrownIcon className="size-4 shrink-0" />
          {t.paywall.upsell}
        </p>
      )}
      {target?.vipOnly && (
        <p className="flex items-center gap-2 rounded-xl bg-gold-soft px-3 py-2 text-sm text-gold">
          <CrownIcon className="size-4 shrink-0" />
          {t.vipExtras.paywallNote}
        </p>
      )}
      {launch && (
        <div className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-accent to-tag px-3 py-2 text-sm font-semibold text-accent-foreground">
          <span className="rounded-md bg-black/20 px-2 py-0.5 text-xs">−{launch.discount_percent}%</span>
          {t.paywall.launchLine(launch.discount_percent, launchDate(launch.ends_at!, locale))}
        </div>
      )}

      <div role="radiogroup" aria-label={t.paywall.title} className="flex flex-col gap-2">
        {plans.map((p) => {
          const selected = plan === p.id;
          return (
            <div
              key={p.id}
              className={`rounded-xl border-2 transition-colors ${
                selected ? "border-accent bg-accent/10" : "border-border bg-surface hover:border-muted"
              }`}
            >
              <button
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => setPlan(p.id)}
                className="flex w-full cursor-pointer items-center gap-3 rounded-xl p-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-focus"
              >
                <span
                  aria-hidden
                  className={`flex size-5 shrink-0 items-center justify-center rounded-full border-2 ${
                    selected ? "border-accent" : "border-muted"
                  }`}
                >
                  {selected && <span className="size-2.5 rounded-full bg-accent" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-1.5 font-semibold">
                    {p.kind === "vip" && <CrownIcon className="size-4 text-gold" />}
                    {labels[p.id]}
                    {p.id === "year" && (
                      <span className="rounded-md bg-gold/20 px-1.5 py-0.5 text-[10px] font-bold text-gold uppercase">
                        {t.paywall.bestValue}
                      </span>
                    )}
                    {p.id === "week" && (
                      <span className="rounded-md bg-accent/20 px-1.5 py-0.5 text-[10px] font-bold text-accent uppercase">
                        {t.paywall.popular}
                      </span>
                    )}
                  </span>
                  {p.kind === "series" && <span className="mt-0.5 block text-xs text-muted">{t.paywall.seriesDayNote}</span>}
                  {p.kind === "episode" && target?.episode && (
                    <span className="mt-0.5 block text-xs text-muted">{t.paywall.episodeNote(target.episode)}</span>
                  )}
                </span>
                <span className="flex shrink-0 flex-col items-end">
                  <span className="text-lg font-bold">{formatIdr(p.price)}</span>
                  {launch && p.price < p.regular_price && (
                    <span className="text-xs text-muted line-through">{formatIdr(p.regular_price)}</span>
                  )}
                </span>
              </button>
              {p.kind === "series" && selected && (
                <label className="flex items-center gap-2 px-3 pb-3 text-sm">
                  <span className="shrink-0 text-muted">{t.paywall.seriesPick}</span>
                  <select
                    value={seriesSlug}
                    onChange={(event) => setSeriesSlug(event.target.value)}
                    className="min-w-0 flex-1 rounded-lg border border-border bg-surface-secondary px-2 py-1.5 text-foreground outline-none focus-visible:ring-2 focus-visible:ring-focus"
                  >
                    {series.map((s) => (
                      <option key={s.slug} value={s.slug}>
                        {s.title}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>
          );
        })}
      </div>
      {chosenKind === "vip" && (
        <div className="-mt-1 flex flex-col gap-2">
          <p className="text-xs text-muted">{t.paywall.plansNote}</p>
          <div className="rounded-xl border border-gold/30 bg-gold-soft p-3">
            <p className="flex items-center gap-1.5 text-sm font-semibold text-gold">
              <CrownIcon className="size-4" />
              {t.paywall.perksTitle}
            </p>
            <ul className="mt-2 grid gap-1.5 text-sm sm:grid-cols-2">
              {t.paywall.perks.map((perk) => (
                <li key={perk} className="flex items-start gap-2">
                  <span aria-hidden className="mt-0.5 text-gold">✓</span>
                  {perk}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {!joined && (
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium">{t.paywall.email}</span>
          <input
            type="email"
            inputMode="email"
            autoComplete="email"
            required
            value={email}
            onChange={(event) => { setEmail(event.target.value); setEmailTaken(false); setError(undefined); }}
            placeholder="you@example.com"
            disabled={pending !== null}
            className="rounded-xl border border-border bg-surface-secondary px-3 py-2.5 text-foreground outline-none focus-visible:ring-2 focus-visible:ring-focus"
          />
          <span className="text-xs text-muted">{t.paywall.emailNote}</span>
        </label>
      )}
      {methods.length === 0 ? (
        <p className="text-sm text-danger">{t.paywall.unavailable}</p>
      ) : (
        <div className="flex flex-col gap-2 sm:flex-row">
          {methods.map((method) => (
            <Button
              key={method}
              variant={method === methods[0] ? "primary" : "secondary"}
              fullWidth
              isPending={pending === method}
              isDisabled={pending !== null && pending !== method}
              onPress={() => pay(method)}
            >
              {pending === method ? t.paywall.opening : PAY_LABEL[method](t)}
            </Button>
          ))}
        </div>
      )}
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}{" "}
          {emailTaken && onSignIn && (
            <button type="button" onClick={onSignIn} className="cursor-pointer font-semibold underline underline-offset-2">
              {t.paywall.signIn}
            </button>
          )}
        </p>
      )}
      <p className="text-center text-xs leading-5 text-muted">
        {t.consent.payLead}{" "}
        <Link href={withLocale("/legal/terms", locale)} target="_blank" className="text-foreground underline underline-offset-2">
          {t.consent.termsShort}
        </Link>{" "}
        {t.consent.and}{" "}
        <Link href={withLocale("/legal/refunds", locale)} target="_blank" className="text-foreground underline underline-offset-2">
          {t.consent.refunds}
        </Link>{" "}
        {t.consent.payTail} {t.paywall.secured}
      </p>
    </div>
  );
}
