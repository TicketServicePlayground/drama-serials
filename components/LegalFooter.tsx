import Link from "next/link";
import { getDictionary, withLocale, type Locale } from "@/lib/i18n";
import { LEGAL_SLUGS, legalDocs, OPERATOR } from "@/lib/legal";

/** Links to the legal documents plus the operator's name. */
export function LegalFooter({ locale, className = "" }: { locale: Locale; className?: string }) {
  const docs = legalDocs(locale);
  const t = getDictionary(locale);
  return (
    <footer className={`border-t border-separator pt-5 pb-2 text-xs text-muted ${className}`}>
      <nav aria-label={t.legal.documents} className="flex flex-wrap gap-x-4 gap-y-2">
        {LEGAL_SLUGS.map((slug) => (
          <Link key={slug} href={withLocale(`/legal/${slug}`, locale)} className="hover:text-foreground hover:underline">
            {docs[slug].short}
          </Link>
        ))}
      </nav>
      <p className="mt-3">© {new Date().getFullYear()} {OPERATOR.name}</p>
    </footer>
  );
}
