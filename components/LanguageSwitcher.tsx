"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { getDictionary, LOCALES, withLocale, type Locale } from "@/lib/i18n";

export function LanguageSwitcher({ locale }: { locale: Locale }) {
  const pathname = usePathname();
  return (
    <nav aria-label={getDictionary(locale).languageLabel} className="flex rounded-lg bg-surface p-0.5 text-xs font-medium">
      {LOCALES.map((item) => (
        <Link
          key={item}
          href={withLocale(pathname, item)}
          aria-current={item === locale ? "true" : undefined}
          className={`rounded-md px-2 py-1 uppercase outline-none transition-colors focus-visible:ring-2 focus-visible:ring-focus ${
            item === locale ? "bg-surface-tertiary text-foreground" : "text-muted hover:text-foreground"
          }`}
        >
          {item}
        </Link>
      ))}
    </nav>
  );
}
