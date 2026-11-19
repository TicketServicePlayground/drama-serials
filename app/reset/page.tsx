import type { Metadata } from "next";
import { LegalFooter } from "@/components/LegalFooter";
import { Logo } from "@/components/Logo";
import { ResetPasswordForm } from "@/components/ResetPasswordForm";
import { getDictionary, withLocale } from "@/lib/i18n";
import { getLocale } from "@/lib/locale";

export const metadata: Metadata = { title: "Password", robots: { index: false, follow: false } };

/** The page an emailed "forgot password" link opens: a new password, then signed in. */
export default async function ResetPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const [{ token = "" }, locale] = await Promise.all([searchParams, getLocale()]);
  const t = getDictionary(locale);
  return (
    <div className="mx-auto w-full max-w-sm flex-1 px-4 pb-10">
      <header className="flex justify-center py-4">
        <Logo href={withLocale("/", locale)} size="sm" />
      </header>
      <h1 className="mt-6 text-xl font-bold">{t.auth.forgotHeading}</h1>
      <ResetPasswordForm locale={locale} token={token} />
      <LegalFooter locale={locale} className="mt-10" />
    </div>
  );
}
