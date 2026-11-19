import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BackIcon, UserIcon } from "@/components/icons";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { Logo } from "@/components/Logo";
import { LegalFooter } from "@/components/LegalFooter";
import { SeriesView } from "@/components/SeriesView";
import { getAccount } from "@/lib/auth";
import { getBillingConfig, getMediaDurations } from "@/lib/billing";
import { findSerial, getCatalog } from "@/lib/catalog";
import { readCollections } from "@/lib/collections-server";
import { getDictionary, withLocale } from "@/lib/i18n";
import { getLocale } from "@/lib/locale";
import { getRealViews, withRealViews } from "@/lib/views";
import { pageMetadata } from "@/lib/seo";

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<{ play?: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const [{ slug }, locale] = await Promise.all([params, getLocale()]);
  const serial = findSerial(slug, locale);
  return serial ? pageMetadata(locale, `/series/${serial.slug}`, serial) : {};
}

export default async function SeriesPage({ params, searchParams }: Props) {
  const [{ slug }, { play }, locale] = await Promise.all([params, searchParams, getLocale()]);
  const serial = findSerial(slug, locale);
  if (!serial) notFound();
  // Episodes are for signed-in users; everyone else gets the sign-up dialog.
  const [account, config, collections, durations, views] = await Promise.all([
    getAccount(),
    getBillingConfig(),
    readCollections(),
    getMediaDurations(),
    getRealViews(),
  ]);
  const real = withRealViews(getCatalog(locale), views).find((s) => s.slug === serial.slug) ?? serial;
  // Uploaded videos report their real length; the catalog value stands in until then.
  const withDurations = {
    ...real,
    episodes: real.episodes.map((e) => ({ ...e, duration: durations[e.id] ?? e.duration })),
  };
  const autoPlay = play && /^\d{1,3}$/.test(play) ? Number(play) : null;
  const t = getDictionary(locale);

  return (
    <div className="mx-auto w-full max-w-3xl flex-1 px-3 pb-10 sm:px-6">
      <header className="sticky top-0 z-20 -mx-3 flex items-center justify-between gap-2 bg-background/95 px-3 py-3 backdrop-blur sm:-mx-6 sm:px-6">
        <Link
          href={withLocale("/", locale)}
          className="-ml-1 flex items-center gap-1 rounded-md px-1 text-sm text-muted outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-focus"
        >
          <BackIcon className="size-5" /><span className="hidden sm:inline">{t.series.back}</span>
        </Link>
        <Logo href={withLocale("/", locale)} size="sm" />
        <div className="flex items-center gap-2">
          <LanguageSwitcher locale={locale} />
          <Link
            href={withLocale("/profile", locale)}
            aria-label={t.profile.title}
            className="flex size-8 items-center justify-center rounded-lg bg-surface text-foreground outline-none hover:bg-surface-secondary focus-visible:ring-2 focus-visible:ring-focus"
          >
            <UserIcon className="size-5" />
          </Link>
        </div>
      </header>
      <SeriesView
        serial={withDurations}
        locale={locale}
        initialCollections={collections}
        account={account}
        freeEpisodes={config.free_episodes}
        seriesOptions={getCatalog(locale)
          .filter((s) => !s.vip)
          .map((s) => ({ slug: s.slug, title: s.title }))}
        autoPlay={account ? autoPlay : null}
      />
      <LegalFooter locale={locale} className="mt-10" />
    </div>
  );
}
