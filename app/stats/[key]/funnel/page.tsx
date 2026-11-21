import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { apiFetch } from "@/lib/api";
import { formatIdr } from "@/lib/billing-types";
import { findSerial } from "@/lib/catalog";

// Counts of each step on the way to a payment (backend/app/visits.py); the key in the link is STATS_KEY.
export const metadata: Metadata = { title: "Воронка", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

type Step = "visit" | "cover" | "auth_open" | "signup" | "series" | "episode" | "email_gate" | "paywall" | "checkout" | "paid";
type Counts = Record<Step, number> & { emails: number; revenue: number };
interface Funnel {
  timezone: string;
  period: string;
  country: string;
  countries: string[];
  steps: Step[];
  total: Counts;
  by_source: (Counts & { source: string })[];
  by_country: (Counts & { country: string })[];
  by_campaign: (Counts & { campaign: string; content: string })[];
  by_ab: (Counts & { ab: string })[];
  by_series: { slug: string; cover: number; series: number; episode: number; paywall: number; paid: number; revenue: number }[];
}

// [name, short name, how it is counted]
const STEP: Record<Step, [string, string, string]> = {
  visit: ["Визиты (просмотры страниц)", "визиты", "каждое открытие любой страницы"],
  cover: ["Нажатия на обложку", "обложка", "каждое нажатие на обложку"],
  auth_open: ["Показы окна регистрации", "окно рег.", "каждый показ окна"],
  signup: ["Регистрации", "рег.", "новые аккаунты"],
  series: ["Открытия страницы сериала", "сериал", "каждое открытие /series/…"],
  episode: ["Нажатия на серию", "серия", "каждое нажатие на серию"],
  email_gate: ["Показы email-окна", "email", "каждый показ окна «серии за email»"],
  paywall: ["Показы тарифов", "тарифы", "каждый показ тарифов"],
  checkout: ["Начатые оплаты", "оплата", "каждый созданный платёж"],
  paid: ["Оплаты", "оплатили", "каждый оплаченный платёж"],
};
const PERIODS: [string, string][] = [
  ["today", "Сегодня"],
  ["yesterday", "Вчера"],
  ["7d", "7 дней"],
  ["30d", "30 дней"],
];

const seriesName = (slug: string) => (slug === "vip" ? "VIP-страница" : (findSerial(slug, "ru")?.title ?? slug));

export default async function FunnelPage({ params, searchParams }: {
  params: Promise<{ key: string }>;
  searchParams: Promise<{ period?: string; country?: string }>;
}) {
  const [{ key }, { period = "7d", country = "" }] = await Promise.all([params, searchParams]);
  const query = new URLSearchParams({ key, period, country });
  const { status, data } = await apiFetch<Funnel>(`/funnel?${query}`);
  if (status !== 200) notFound();

  const base = `/stats/${encodeURIComponent(key)}`;
  // Links keep the other filters.
  const href = (change: Record<string, string>) => {
    const next = { period: data.period, country: data.country, ...change };
    const qs = new URLSearchParams(Object.entries(next).filter(([, v]) => v) as [string, string][]);
    return `${base}/funnel?${qs}`;
  };
  const countryName = (code: string) => {
    if (!code) return "не определена";
    try {
      return `${new Intl.DisplayNames(["ru"], { type: "region" }).of(code) ?? code} (${code})`;
    } catch {
      return code;
    }
  };
  const now = new Intl.DateTimeFormat("ru-RU", { timeZone: data.timezone, hour: "2-digit", minute: "2-digit" }).format(new Date());

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-6">
      <header className="mb-4 flex items-baseline justify-between gap-3">
        <h1 className="font-display text-xl font-extrabold">Воронка</h1>
        <span className="flex gap-3 text-xs text-muted">
          <Link href={base} className="underline-offset-2 hover:underline">← посетители</Link>
          <Link href={`${base}/raw`} className="underline-offset-2 hover:underline">сырые данные →</Link>
          <a href="" className="underline-offset-2 hover:underline">обновлено {now} WITA ↻</a>
        </span>
      </header>

      <nav className="mb-5 flex gap-1.5 text-sm">
        {PERIODS.map(([id, label]) => (
          <Link
            key={id}
            href={href({ period: id })}
            className={`rounded-lg px-3 py-1.5 ${data.period === id ? "bg-foreground text-background" : "bg-surface-secondary text-muted"}`}
          >
            {label}
          </Link>
        ))}
      </nav>

      <div className="mb-5 flex flex-wrap items-center gap-1.5 text-sm">
        <span className="text-xs text-muted">страна:</span>
        {["", ...data.countries].map((code) => (
          <Link
            key={code || "all"}
            href={href({ country: code })}
            className={`rounded-lg px-2.5 py-1 ${data.country === code ? "bg-foreground text-background" : "bg-surface-secondary text-muted"}`}
          >
            {code || "все"}
          </Link>
        ))}
      </div>

      <section>
        <div className="mb-1 flex justify-end gap-3 text-xs text-muted">
          <span className="w-16 text-right">сколько</span>
        </div>
        <ol className="flex flex-col gap-1.5">
          {data.steps.map((step, i) => {
            return (
              <li key={step} className="rounded-lg border border-border bg-surface px-3 py-2">
                <div className="flex items-center gap-3 text-sm tabular-nums">
                  <span className="flex-1 truncate">
                    <span className="text-muted">{i + 1}.</span> {STEP[step][0]}
                  </span>
                  <span className="w-16 text-right text-base font-bold">{data.total[step]}</span>
                </div>
                <p className="text-xs text-muted">{STEP[step][2]}</p>
              </li>
            );
          })}
        </ol>
        <p className="mt-2 text-xs text-muted tabular-nums">Выручка за период: {formatIdr(data.total.revenue)}</p>
        <p className="mt-2 text-xs text-muted">
          Все числа — просто количество строк за период, никого не склеиваем и не угадываем. Визиты и клики — строки
          visits, регистрации — строки users, оплаты — строки payments. Источник, кампания, объявление, страна и группа
          A/B лежат в самой строке: браузер запоминает метку (utm) последней ссылки, по которой пришёл, и отправляет её с
          каждым визитом, регистрацией и оплатой. У строк до 21.11 метки есть только у визита-прихода по ссылке, у старых
          оплат — нет. Источник без utm — сайт, с которого пришли. Дни — по Бали (WITA).
        </p>
      </section>

      <section className="mt-6">
        <h2 className="mb-2 text-sm font-semibold">A/B: сразу тарифы или email → тарифы</h2>
        {(data.by_ab ?? []).length === 0 ? (
          <p className="text-xs text-muted">пока пусто</p>
        ) : (
          <div className="-mx-4 overflow-x-auto px-4">
            <table className="w-full min-w-[560px] text-sm tabular-nums">
              <thead className="text-xs text-muted">
                <tr className="text-right">
                  <th className="py-1 text-left font-normal">группа</th>
                  <th className="font-normal">зашли</th>
                  <th className="font-normal">email-окно</th>
                  <th className="font-normal">email подтв.</th>
                  <th className="font-normal">тарифы</th>
                  <th className="font-normal">рег.</th>
                  <th className="font-normal">оплата</th>
                  <th className="font-normal">оплатили</th>
                  <th className="font-normal">выручка</th>
                </tr>
              </thead>
              <tbody>
                {data.by_ab.map((r) => (
                  <tr key={r.ab} className="border-t border-border text-right">
                    <td className="py-1.5 text-left">{r.ab === "email" ? "email → тарифы" : "сразу тарифы"}</td>
                    <td>{r.visit}</td>
                    <td>{r.email_gate}</td>
                    <td>{r.emails}</td>
                    <td>{r.paywall}</td>
                    <td>{r.signup}</td>
                    <td>{r.checkout}</td>
                    <td>{r.paid}</td>
                    <td>{formatIdr(r.revenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-2 text-xs text-muted">
          Группа (ab) записана в каждой строке. «email → тарифы»: на первой закрытой серии один раз предлагаем ещё 3
          серии за email, тарифы — после них. «email подтв.» — строки users, где email подтверждён кодом за период
          (email_gate_at). Остальные столбцы — как в воронке выше.
        </p>
      </section>

      <StepTable
        title="По странам"
        steps={data.steps}
        rows={data.by_country.map((r) => ({ ...r, label: countryName(r.country) }))}
        note="Страна — по IP запроса (Cloudflare / nginx), записана в каждой строке."
      />
      <StepTable
        title="По кампаниям и объявлениям"
        steps={data.steps}
        rows={data.by_campaign.map((r) => ({
          ...r,
          label: r.campaign ? `${r.campaign}${r.content ? ` → ${r.content}` : ""}` : "без кампании",
        }))}
        note="utm_campaign → utm_content из строки. Ссылки рекламы: ?utm_source=meta&utm_medium=paid&utm_campaign={{campaign.name}}&utm_content={{ad.name}} (TikTok: utm_source=tiktok)."
      />
      <StepTable
        title="По источникам"
        steps={data.steps}
        rows={data.by_source.map((r) => ({ ...r, label: r.source || "прямой / приложение" }))}
        note="Источник = utm_source из строки, иначе сайт, с которого пришли (например, l.instagram.com)."
      />

      <section className="mt-6">
        <h2 className="mb-2 text-sm font-semibold">По сериалам</h2>
        {data.by_series.length === 0 ? (
          <p className="text-xs text-muted">пока пусто</p>
        ) : (
          <table className="w-full text-sm tabular-nums">
            <thead className="text-xs text-muted">
              <tr className="text-right">
                <th className="py-1 text-left font-normal">сериал</th>
                <th className="px-1 font-normal">обложка</th>
                <th className="px-1 font-normal">открыли</th>
                <th className="px-1 font-normal">серия</th>
                <th className="px-1 font-normal">тарифы</th>
                <th className="px-1 font-normal">оплаты</th>
                <th className="px-1 font-normal">выручка</th>
              </tr>
            </thead>
            <tbody>
              {data.by_series.map((row) => (
                <tr key={row.slug} className="border-t border-border text-right">
                  <td className="max-w-48 truncate py-1.5 text-left">{seriesName(row.slug)}</td>
                  <td className="px-1">{row.cover}</td>
                  <td className="px-1">{row.series}</td>
                  <td className="px-1">{row.episode}</td>
                  <td className="px-1">{row.paywall}</td>
                  <td className="px-1">{row.paid}</td>
                  <td className="px-1">{row.revenue ? formatIdr(row.revenue) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

    </main>
  );
}

type StepRow = Counts & { label: string };

function StepTable({ title, steps, rows, note }: {
  title: string;
  steps: Step[];
  rows: StepRow[];
  note: string;
}) {
  return (
    <section className="mt-6">
      <h2 className="mb-2 text-sm font-semibold">{title}</h2>
      {rows.length === 0 ? (
        <p className="text-xs text-muted">пока пусто</p>
      ) : (
        <div className="-mx-4 overflow-x-auto px-4">
          <table className="w-full min-w-[720px] text-sm tabular-nums">
            <thead className="text-xs text-muted">
              <tr className="text-right">
                <th className="py-1 text-left font-normal">{title.replace(/^По /, "").split(" ")[0]}</th>
                {steps.map((s) => (
                  <th key={s} className="px-1 font-normal">{STEP[s][1]}</th>
                ))}
                <th className="px-1 font-normal">выручка</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.label} className="border-t border-border text-right">
                  <td className="max-w-48 truncate py-1.5 text-left" title={row.label}>{row.label}</td>
                  {steps.map((s) => (
                    <td key={s} className={`px-1 ${row[s] === 0 ? "text-muted" : ""}`}>{row[s]}</td>
                  ))}
                  <td className={`px-1 ${row.revenue ? "" : "text-muted"}`}>{row.revenue ? formatIdr(row.revenue) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-2 text-xs text-muted">{note}</p>
    </section>
  );
}
