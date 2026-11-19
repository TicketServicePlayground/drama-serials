import type { Locale } from "./i18n";
import { LEGAL_EN } from "./legal-en";
import { LEGAL_ES } from "./legal-es";
import { LEGAL_ID } from "./legal-id";
import { LEGAL_RU } from "./legal-ru";

/** Bump together with TERMS_VERSION in the API (backend/app/config.py) when a document changes. */
export const TERMS_VERSION = "2026-11-17.2";

/** Who runs the service. Payments are collected through this company's Xendit and DOKU accounts. */
export const OPERATOR = {
  name: "PT LTV CAC GROUP",
  address:
    "GoWork Plaza Indonesia, Level 5, Unit E021AB, Jl. M.H. Thamrin Kav. 28-30, Jakarta 10350, Indonesia",
  email: "ceo@ltvcac.agency",
  site: "affinet.link",
} as const;

export const LEGAL_SLUGS = ["terms", "privacy", "refunds", "cookies", "contacts"] as const;
export type LegalSlug = (typeof LEGAL_SLUGS)[number];

export interface LegalDoc {
  title: string;
  /** Short name for footers and links. */
  short: string;
  intro?: string;
  sections: { heading: string; paragraphs: string[] }[];
}

export type LegalSet = Record<LegalSlug, LegalDoc> & { updated: string };

const SETS: Record<Locale, LegalSet> = { en: LEGAL_EN, id: LEGAL_ID, es: LEGAL_ES, ru: LEGAL_RU };

/** Documents with {name}, {address}, {email}, {site} filled in. */
export function legalDocs(locale: Locale): LegalSet {
  const fill = (text: string) =>
    text
      .replaceAll("{name}", OPERATOR.name)
      .replaceAll("{address}", OPERATOR.address)
      .replaceAll("{email}", OPERATOR.email)
      .replaceAll("{site}", OPERATOR.site);
  const set = SETS[locale];
  const out = { updated: set.updated } as LegalSet;
  for (const slug of LEGAL_SLUGS) {
    const doc = set[slug];
    out[slug] = {
      title: doc.title,
      short: doc.short,
      intro: doc.intro && fill(doc.intro),
      sections: doc.sections.map((s) => ({ heading: s.heading, paragraphs: s.paragraphs.map(fill) })),
    };
  }
  return out;
}
