import type { Metadata } from "next";
import Link from "next/link";
import { BackIcon } from "@/components/icons";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { Logo } from "@/components/Logo";
import { LocalDate } from "@/components/LocalDate";
import { PaywallPanel } from "@/components/PaywallPanel";
import { LegalFooter } from "@/components/LegalFooter";
import { CrownIcon } from "@/components/icons";
import { getAccount } from "@/lib/auth";
import { getCatalog } from "@/lib/catalog";
import { getDictionary, withLocale } from "@/lib/i18n";
import { getLocale } from "@/lib/locale";

export const metadata: Metadata = { title: "VIP" };

export default async function VipPage() {
  // Guests buy here too: QRIS/SBP need nothing, a card asks for an email at payment.
  const [locale, account] = await Promise.all([getLocale(), getAccount()]);
  const t = getDictionary(locale);
  return (
    <div className="mx-auto w-full max-w-xl flex-1 px-3 pb-10 sm:px-6">
      <header className="flex items-center justify-between gap-2 py-3">
        <Link
          href={withLocale("/", locale)}
          className="-ml-1 flex items-center gap-1 rounded-md px-1 text-sm text-muted outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-focus"
        >
          <BackIcon className="size-5" /><span className="hidden sm:inline">{t.vip.back}</span>
        </Link>
        <Logo href={withLocale("/", locale)} size="sm" />
        <LanguageSwitcher locale={locale} />
      </header>
      <h1 className="mt-4 text-2xl font-bold">{t.paywall.title}</h1>
      {account?.has_access && account.access_until && (
        <p className="mt-3 flex items-center gap-2 rounded-xl bg-gold-soft px-3 py-2 text-sm text-gold">
          <CrownIcon className="size-4" />
          {t.paywall.activeUntil} <LocalDate iso={account.access_until} locale={locale} />
        </p>
      )}
      <div className="mt-4">
        <PaywallPanel
          locale={locale}
          series={getCatalog(locale)
            .filter((s) => !s.vip)
            .map((s) => ({ slug: s.slug, title: s.title }))}
          signedIn={account !== null}
          hasEmail={Boolean(account?.email)}
          signInHref={withLocale("/?auth=vip", locale)}
        />
      </div>
      <LegalFooter locale={locale} className="mt-10" />
    </div>
  );
}
