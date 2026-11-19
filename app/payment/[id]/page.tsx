import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Logo } from "@/components/Logo";
import { PaymentResult } from "@/components/PaymentResult";
import { getAccount } from "@/lib/auth";
import { withLocale } from "@/lib/i18n";
import { getLocale } from "@/lib/locale";

export const metadata: Metadata = { title: "Payment" };

/** Where Xendit sends the payer back to, paid or not. */
export default async function PaymentPage({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }, locale, account] = await Promise.all([params, getLocale(), getAccount()]);
  if (!account) redirect(withLocale("/?auth=vip", locale));
  return (
    <div className="mx-auto flex w-full max-w-md flex-1 flex-col px-4 pb-10">
      <header className="flex justify-center py-4">
        <Logo href={withLocale("/", locale)} size="sm" />
      </header>
      <PaymentResult id={id} locale={locale} />
    </div>
  );
}
