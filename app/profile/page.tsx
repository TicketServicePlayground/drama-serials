import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CrownIcon, BackIcon } from "@/components/icons";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { LegalFooter } from "@/components/LegalFooter";
import { LocalDate } from "@/components/LocalDate";
import { Logo } from "@/components/Logo";
import { LogoutButton } from "@/components/LogoutButton";
import { PointsCard, type PointsState } from "@/components/PointsCard";
import { apiFetch } from "@/lib/api";
import { getAccount, getToken } from "@/lib/auth";
import { formatIdr } from "@/lib/billing-types";
import { findSerial } from "@/lib/catalog";
import { getDictionary, withLocale } from "@/lib/i18n";
import { getLocale } from "@/lib/locale";

export const metadata: Metadata = { title: "Profile" };

interface Purchase {
  id: string;
  product: "episode" | "series_day" | "week" | "month" | "year";
  slug: string | null;
  episode: number | null;
  amount: number;
  list_amount: number | null;
  method: string;
  status: "paid" | "pending" | "expired" | "failed";
  created_at: string;
  paid_at: string | null;
  starts_at: string | null;
  ends_at: string | null;
}

const STATUS_STYLE: Record<Purchase["status"], string> = {
  paid: "bg-success/15 text-success",
  pending: "bg-warning/15 text-warning",
  expired: "bg-surface-tertiary text-muted",
  failed: "bg-danger/15 text-danger",
};

export default async function ProfilePage() {
  const [locale, account, token] = await Promise.all([getLocale(), getAccount(), getToken()]);
  if (!account) redirect(withLocale("/?auth=vip", locale));
  const t = getDictionary(locale);
  const [{ data }, { status: pointsStatus, data: points }] = await Promise.all([
    apiFetch<Purchase[]>("/me/purchases", { token }),
    apiFetch<PointsState>("/me/points", { token }),
  ]);
  const purchases = Array.isArray(data) ? data : [];
  const ended = !account.has_access && account.access_until;

  const label = (p: Purchase) => {
    if (p.product === "episode") {
      const title = p.slug ? (findSerial(p.slug, locale)?.title ?? p.slug) : "";
      return t.profile.episode(p.episode ?? 0, title);
    }
    if (p.product === "series_day") {
      return t.profile.seriesDay(p.slug ? (findSerial(p.slug, locale)?.title ?? p.slug) : "");
    }
    return t.profile[p.product];
  };

  return (
    <div className="mx-auto w-full max-w-2xl flex-1 px-4 pb-10">
      <header className="flex items-center justify-between gap-2 py-3">
        <Link
          href={withLocale("/", locale)}
          className="-ml-1 flex items-center gap-1 rounded-md px-1 text-sm text-muted outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-focus"
        >
          <BackIcon className="size-5" /><span className="hidden sm:inline">{t.legal.back}</span>
        </Link>
        <Logo href={withLocale("/", locale)} size="sm" />
        <LanguageSwitcher locale={locale} />
      </header>

      <h1 className="mt-4 text-2xl font-bold">{t.profile.title}</h1>

      <section className="mt-4 rounded-2xl bg-surface p-4">
        <p className="text-xs text-muted">{t.profile.account}</p>
        <p className="mt-0.5 font-medium break-all">{account.email}</p>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          {account.has_access && account.access_until ? (
            <p className="flex items-center gap-2 text-sm text-gold">
              <CrownIcon className="size-5" />
              {t.profile.vipUntil} <LocalDate iso={account.access_until} locale={locale} />
            </p>
          ) : (
            <p className="text-sm text-muted">
              {ended ? (
                <>
                  {t.profile.vipEnded} <LocalDate iso={account.access_until!} locale={locale} />
                </>
              ) : (
                t.profile.noVip
              )}
            </p>
          )}
          <Link
            href={withLocale("/vip", locale)}
            className="flex h-9 items-center gap-1.5 rounded-lg bg-accent px-3 text-sm font-semibold text-accent-foreground outline-none focus-visible:ring-2 focus-visible:ring-focus"
          >
            <CrownIcon className="size-4" />
            {t.profile.getVip}
          </Link>
        </div>
      </section>

      {pointsStatus === 200 && <PointsCard locale={locale} points={points} isVip={account.has_access} />}

      <h2 className="mt-8 mb-3 text-lg font-semibold">{t.profile.purchases}</h2>
      {purchases.length === 0 ? (
        <p className="rounded-2xl bg-surface p-4 text-sm text-muted">{t.profile.empty}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {purchases.map((p) => (
            <li key={p.id} className="rounded-2xl bg-surface p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  {p.product === "episode" && p.slug ? (
                    <Link href={withLocale(`/series/${p.slug}`, locale)} className="font-medium hover:underline">
                      {label(p)}
                    </Link>
                  ) : (
                    <p className="font-medium">{label(p)}</p>
                  )}
                  <p className="mt-0.5 text-xs text-muted">
                    {p.status === "paid" && p.paid_at ? t.profile.paidAt : t.profile.openedAt}{" "}
                    <LocalDate iso={p.paid_at ?? p.created_at} locale={locale} /> · {t.profile.method[p.method] ?? p.method}
                  </p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <span className="font-semibold">{formatIdr(p.amount)}</span>
                  {p.list_amount && p.list_amount > p.amount && (
                    <span className="text-xs text-muted line-through" title={t.profile.regular}>
                      {formatIdr(p.list_amount)}
                    </span>
                  )}
                </div>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                <span className={`rounded-md px-2 py-0.5 font-medium ${STATUS_STYLE[p.status]}`}>
                  {t.profile.status[p.status] ?? p.status}
                </span>
                {p.status === "paid" &&
                  (p.starts_at && p.ends_at ? (
                    <span className="text-muted">
                      {t.profile.starts} <LocalDate iso={p.starts_at} locale={locale} /> → {t.profile.ends}{" "}
                      <LocalDate iso={p.ends_at} locale={locale} />
                    </span>
                  ) : (
                    p.product === "episode" && <span className="text-muted">{t.profile.forever}</span>
                  ))}
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-8 flex justify-end">
        <LogoutButton locale={locale} />
      </div>
      <LegalFooter locale={locale} className="mt-6" />
    </div>
  );
}
