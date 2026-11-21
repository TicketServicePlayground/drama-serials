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
type VisitStep = "visit" | "cover" | "auth_open" | "series" | "episode" | "email_gate" | "paywall";
type Counts = Record<Step, number> & Record<`${VisitStep}_rows`, number> & { visit_no_id: number; emails: number; revenue: number };
interface Funnel {
  timezone: string;
  period: string;
  country: string;
  countries: string[];
  steps: Step[];
  visit_steps: VisitStep[];
  total: Partial<Counts>;
  by_source: (Counts & { source: string })[];
  by_country: (Counts & { country: string })[];
  by_campaign: (Counts & { campaign: string; content: string })[];
  by_ab: (Counts & { ab: string })[];
  by_series: { slug: string; cover: number; cover_rows: number; series: number; series_rows: number; episode: number; episode_rows: number; paywall: number; paywall_rows: number }[];
}

// [name, short name, how it is counted]
const STEP: Record<Step, [string, string, string]> = {
  visit: ["Зашли на сайт", "зашли", "браузеры с просмотром страницы"],
  cover: ["Нажали на обложку", "обложка", "браузеры с событием cover"],
  auth_open: ["Увидели регистрацию", "окно рег.", "браузеры с событием auth_open"],
  signup: ["Зарегистрировались", "рег.", "строки users, созданные за период"],
  series: ["Открыли сериал", "сериал", "браузеры с просмотром /series/…"],
  episode: ["Нажали на серию", "серия", "браузеры с событием episode"],
  email_gate: ["Попросили email", "email", "браузеры с событием email_gate"],
  paywall: ["Увидели тарифы", "тарифы", "браузеры с событием paywall"],
  checkout: ["Начали оплату", "оплата", "строки payments, созданные за период"],
  paid: ["Оплатили", "оплатили", "строки payments со status = paid, оплаченные за период"],
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
          <span className="w-16 text-right">число</span>
          <span className="w-16 text-right">строк</span>
        </div>
        <ol className="flex flex-col gap-1.5">
          {data.steps.map((step, i) => {
            const rows = data.visit_steps.includes(step as VisitStep) ? data.total[`${step as VisitStep}_rows`] : undefined;
            return (
              <li key={step} className="rounded-lg border border-border bg-surface px-3 py-2">
                <div className="flex items-center gap-3 text-sm tabular-nums">
                  <span className="flex-1 truncate">
                    <span className="text-muted">{i + 1}.</span> {STEP[step][0]}
                  </span>
                  <span className="w-16 text-right text-base font-bold">{data.total[step] ?? 0}</span>
                  <span className="w-16 text-right text-xs text-muted">{rows ?? ""}</span>
                </div>
                <p className="text-xs text-muted">{STEP[step][2]}</p>
              </li>
            );
          })}
        </ol>
        <p className="mt-2 text-xs text-muted tabular-nums">
          Выручка за период: {formatIdr(data.total.revenue ?? 0)} · просмотров без id браузера: {data.total.visit_no_id ?? 0}
        </p>
        <p className="mt-2 text-xs text-muted">
          Как считается, без догадок. Браузер = id, который браузер хранит у себя (client_id); склейки людей по IP или
          модели телефона нет. «Строк» — сколько всего таких строк в таблице visits, включая повторы и строки без id.
          Источник, кампания, объявление, страна и группа A/B браузера — первое непустое значение в его строках.
          Регистрация и оплата относятся к браузеру, в котором пользователь впервые был в аккаунте (или с которого
          создал платёж); если такого нет — к «без источника», но в итог они всё равно входят. Дни — по Бали (WITA).
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
          Группа браузера (visits.ab) выбирается случайно один раз. «email → тарифы»: на первой закрытой серии один раз
          предлагаем ещё 3 серии за email, тарифы — после них. «email подтв.» — пользователи группы, подтвердившие email
          кодом за период (users.email_gate_at). Остальные столбцы — как в воронке выше.
        </p>
      </section>

      <StepTable
        title="По странам"
        steps={data.steps}
        rows={data.by_country.map((r) => ({ ...r, label: countryName(r.country) }))}
        note="Страна браузера — первая непустая страна в его строках (по IP через Cloudflare / nginx)."
      />
      <StepTable
        title="По кампаниям и объявлениям"
        steps={data.steps}
        rows={data.by_campaign.map((r) => ({
          ...r,
          label: r.campaign ? `${r.campaign}${r.content ? ` → ${r.content}` : ""}` : "без кампании",
        }))}
        note="utm_campaign → utm_content — первые непустые у браузера. Ссылки рекламы: ?utm_source=meta&utm_medium=paid&utm_campaign={{campaign.name}}&utm_content={{ad.name}} (TikTok: utm_source=tiktok)."
      />
      <StepTable
        title="По источникам"
        steps={data.steps}
        rows={data.by_source.map((r) => ({ ...r, label: r.source || "прямой / приложение" }))}
        note="Источник браузера = первый непустой utm_source, иначе первый сайт, с которого пришёл (например, l.instagram.com). Страницы оплаты источником не записываются."
      />

      <section className="mt-6">
        <h2 className="mb-2 text-sm font-semibold">По сериалам</h2>
        <p className="mb-2 text-xs text-muted">браузеры · строк</p>
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
              </tr>
            </thead>
            <tbody>
              {data.by_series.map((row) => (
                <tr key={row.slug} className="border-t border-border text-right">
                  <td className="max-w-48 truncate py-1.5 text-left">{seriesName(row.slug)}</td>
                  <td className="px-1">{row.cover} <span className="text-xs text-muted">· {row.cover_rows}</span></td>
                  <td className="px-1">{row.series} <span className="text-xs text-muted">· {row.series_rows}</span></td>
                  <td className="px-1">{row.episode} <span className="text-xs text-muted">· {row.episode_rows}</span></td>
                  <td className="px-1">{row.paywall} <span className="text-xs text-muted">· {row.paywall_rows}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

    </main>
  );
}

type StepRow = Record<Step, number> & { label: string; revenue: number };

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
