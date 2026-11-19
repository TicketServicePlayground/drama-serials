import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BackIcon } from "@/components/icons";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { LegalFooter } from "@/components/LegalFooter";
import { Logo } from "@/components/Logo";
import { getDictionary, withLocale } from "@/lib/i18n";
import { LEGAL_SLUGS, legalDocs, type LegalSlug } from "@/lib/legal";
import { getLocale } from "@/lib/locale";

type Props = { params: Promise<{ slug: string }> };

const isSlug = (value: string): value is LegalSlug => (LEGAL_SLUGS as readonly string[]).includes(value);

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const [{ slug }, locale] = await Promise.all([params, getLocale()]);
  return isSlug(slug) ? { title: legalDocs(locale)[slug].title } : {};
}

export default async function LegalPage({ params }: Props) {
  const [{ slug }, locale] = await Promise.all([params, getLocale()]);
  if (!isSlug(slug)) notFound();
  const docs = legalDocs(locale);
  const doc = docs[slug];
  const t = getDictionary(locale);
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
      <article className="mt-4">
        <h1 className="text-2xl font-bold">{doc.title}</h1>
        <p className="mt-1 text-xs text-muted">{docs.updated}</p>
        {doc.intro && <p className="mt-5 text-sm leading-6 text-foreground/90">{doc.intro}</p>}
        {doc.sections.map((section) => (
          <section key={section.heading} className="mt-6">
            <h2 className="text-base font-semibold">{section.heading}</h2>
            {section.paragraphs.map((paragraph) => (
              <p key={paragraph} className="mt-2 text-sm leading-6 text-muted">
                {paragraph}
              </p>
            ))}
          </section>
        ))}
      </article>
      <LegalFooter locale={locale} className="mt-10" />
    </div>
  );
}
