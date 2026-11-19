import type { Metadata } from "next";
import { LegalFooter } from "@/components/LegalFooter";
import { Showcase } from "@/components/Showcase";
import { getSessionEmail } from "@/lib/auth";
import { findSerial, getCatalog, toCard } from "@/lib/catalog";
import { getMediaDurations } from "@/lib/billing";
import { readCollections } from "@/lib/collections-server";
import { getLocale } from "@/lib/locale";
import { getRealViews, withRealViews } from "@/lib/views";
import { pageMetadata } from "@/lib/seo";

type Props = { searchParams: Promise<{ auth?: string }> };

/** A shared series link lands here (series pages need an account), so it previews as that series. */
export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const [locale, { auth }] = await Promise.all([getLocale(), searchParams]);
  const serial = auth ? findSerial(auth, locale) : undefined;
  return pageMetadata(locale, serial ? `/series/${serial.slug}` : "/", serial);
}

export default async function HomePage({ searchParams }: Props) {
  const [locale, email, collections, { auth }, durations, views] = await Promise.all([
    getLocale(),
    getSessionEmail(),
    readCollections(),
    searchParams,
    getMediaDurations(),
    getRealViews(),
  ]);
  return (
    <Showcase
      locale={locale}
      serials={withRealViews(getCatalog(locale), views).map((serial) => toCard(serial, durations))}
      email={email}
      initialAuthSlug={!email && auth ? auth : null}
      initialCollections={collections}
      footer={<LegalFooter locale={locale} className="mt-10" />}
    />
  );
}
