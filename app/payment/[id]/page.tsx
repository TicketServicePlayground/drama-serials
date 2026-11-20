import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Logo } from "@/components/Logo";
import { PaymentResult } from "@/components/PaymentResult";
import { getAccount } from "@/lib/auth";
import { withLocale } from "@/lib/i18n";
import { getLocale } from "@/lib/locale";

export const metadata: Metadata = { title: "Payment" };

/** Where the provider sends the payer back to, paid or not. */
export default async function PaymentPage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ id }, query, locale, account] = await Promise.all([params, searchParams, getLocale(), getAccount()]);
  const key = typeof query.k === "string" ? query.k : "";
  // A guest's return link carries a signed key: sign them in here (another browser than the one
  // they paid from, often), then come back without it. Accounts with an email use their password.
  if (key && !account?.email) {
    const rest = new URLSearchParams();
    for (const [name, value] of Object.entries(query)) {
      if (name !== "k" && typeof value === "string") rest.set(name, value);
    }
    const next = `/payment/${encodeURIComponent(id)}${rest.size ? `?${rest}` : ""}`;
    redirect(`/api/auth/return?${new URLSearchParams({ payment: id, k: key, next })}`);
  }
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
