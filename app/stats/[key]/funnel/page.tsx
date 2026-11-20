import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { apiFetch } from "@/lib/api";
import { formatIdr } from "@/lib/billing-types";
import { findSerial } from "@/lib/catalog";

// The way from the first page to a payment; the key in the link is STATS_KEY on the server.
export const metadata: Metadata = { title: "Воронка", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

type Step = "visit" | "cover" | "auth_open" | "signup" | "series" | "episode" | "email_gate" | "paywall" | "checkout" | "paid";
type Counts = Record<Step, number> & { revenue: number };
type Attributed = { paid_by_source: number; revenue_by_source: number };
interface Funnel {
  timezone: string;
  period: string;
  country: string;
  countries: string[];
  steps: Step[];
  total: Counts;
  by_source: (Counts & { source: string })[];
  by_country: (Counts & Attributed & { country: string })[];
  by_campaign: (Counts & Attributed & { campaign: string; content: string })[];
  by_series: { slug: string; cover: number; series: number; episode: number; paywall: number }[];
  server: { signups: number; checkouts: number; paid: number; revenue: number };
}

const STEP: Record<Step, [string, string]> = {
  visit: ["Зашли на сайт", "зашли"],
  cover: ["Нажали на обложку", "обложка"],
  auth_open: ["Увидели регистрацию", "окно рег."],
  signup: ["Зарегистрировались", "рег."],
  series: ["Открыли сериал", "сериал"],
  episode: ["Нажали на серию", "серия"],
  email_gate: ["Попросили email", "email"],
  paywall: ["Увидели тарифы", "тарифы"],
  checkout: ["Начали оплату", "оплата"],
  paid: ["Оплатили", "оплатили"],
};
const PERIODS: [string, string][] = [
  ["today", "Сегодня"],
  ["yesterday", "Вчера"],
  ["7d", "7 дней"],
  ["30d", "30 дней"],
];

const pct = (part: number, whole: number) => (whole > 0 ? `${Math.round((part / whole) * 100)}%` : "—");
const seriesName = (slug: string) => (slug === "vip" ? "VIP-страница" : (findSerial(slug, "ru")?.title ?? slug));

export default async function FunnelPage({ params, searchParams }: {
  params: Promise<{ key: string }>;
  searchParams: Promise<{ period?: string; country?: string }>;
}) {
  const [{ key }, { period = "7d", country = "" }] = await Promise.all([params, searchParams]);
  // Everything as it is: test accounts and the team's visits are counted like anyone's.
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
  const top = data.total.visit;
  const now = new Intl.DateTimeFormat("ru-RU", { timeZone: data.timezone, hour: "2-digit", minute: "2-digit" }).format(new Date());

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-6">
      <header className="mb-4 flex items-baseline justify-between gap-3">
        <h1 className="font-display text-xl font-extrabold">Воронка</h1>
        <span className="flex gap-3 text-xs text-muted">
          <Link href={base} className="underline-offset-2 hover:underline">← посетители</Link>
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
          <span className="w-14 text-right">от входа</span>
          <span className="w-14 text-right">от пред.</span>
        </div>
        <ol className="flex flex-col gap-1.5">
          {data.steps.map((step, i) => {
            const value = data.total[step];
            const previous = i > 0 ? data.total[data.steps[i - 1]] : value;
            return (
              <li key={step} className="relative overflow-hidden rounded-lg border border-border bg-surface">
                <div
                  className="absolute inset-y-0 left-0 bg-accent/20"
                  style={{ width: top > 0 ? `${Math.max((value / top) * 100, value > 0 ? 1.5 : 0)}%` : 0 }}
                />
                <div className="relative flex items-center gap-3 px-3 py-2 text-sm tabular-nums">
                  <span className="flex-1 truncate">
                    <span className="text-muted">{i + 1}.</span> {STEP[step][0]}
                  </span>
                  <span className="w-10 text-right text-base font-bold">{value}</span>
                  <span className="w-14 text-right text-xs text-muted">{i === 0 ? "" : pct(value, top)}</span>
                  <span className="w-14 text-right text-xs text-muted">{i === 0 ? "" : pct(value, previous)}</span>
                </div>
              </li>
            );
          })}
        </ol>
        <p className="mt-2 text-xs text-muted">
          Считаются люди за день (одно устройство в один день = 1). Кто уже вошёл в аккаунт, идёт мимо шагов 3–4, поэтому
          «от пред.» бывает больше 100%.
        </p>
      </section>

      <StepTable
        title="По странам"
        steps={data.steps}
        rows={data.by_country.map((r) => ({ ...r, label: countryName(r.country) }))}
        attributed
        note="Страна — по IP первого захода дня. «Оплат по 1-му заходу» — оплаты за период тех, кто впервые пришёл из этой страны, даже если платили через день."
      />
      <StepTable
        title="По кампаниям и объявлениям"
        steps={data.steps}
        rows={data.by_campaign.map((r) => ({
          ...r,
          label: r.campaign ? `${r.campaign}${r.content ? ` → ${r.content}` : ""}` : "без кампании",
        }))}
        attributed
        note="utm_campaign → utm_content. Ссылки рекламы: ?utm_source=meta&utm_medium=paid&utm_campaign={{campaign.name}}&utm_content={{ad.name}} (TikTok: utm_source=tiktok). Оплата через день остаётся за кампанией первого захода."
      />
      <StepTable
        title="По источникам"
        steps={data.steps}
        rows={data.by_source.map((r) => ({ ...r, label: r.source || "прямой / приложение" }))}
        note="Источник = utm_source, иначе сайт, с которого пришли (например, l.instagram.com). Возвраты со страниц оплаты не считаются источником."
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
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="mt-6 rounded-xl border border-border bg-surface p-3 text-sm">
        <h2 className="mb-1 text-sm font-semibold">По базе за период</h2>
        <p className="tabular-nums">
          регистраций {data.server.signups} · оплат начато {data.server.checkouts} · оплачено {data.server.paid}
          {data.server.revenue > 0 && <> · {formatIdr(data.server.revenue)}</>}
        </p>
        <p className="mt-1 text-xs text-muted">
          Прямо из таблиц, без привязки к счётчику: если тут больше, чем в воронке, часть людей счётчик не увидел
          (блокировщики).
        </p>
      </section>
    </main>
  );
}

type StepRow = Record<Step, number> & { label: string; revenue: number; paid_by_source?: number; revenue_by_source?: number };

function StepTable({ title, steps, rows, attributed = false, note }: {
  title: string;
  steps: Step[];
  rows: StepRow[];
  attributed?: boolean;
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
                <th className="px-1 font-normal">визит→оплата</th>
                {attributed && <th className="px-1 font-normal">оплат по 1-му заходу</th>}
                {attributed && <th className="px-1 font-normal">выручка по 1-му заходу</th>}
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
                  <td className="px-1 text-muted">{pct(row.paid, row.visit)}</td>
                  {attributed && <td className={`px-1 ${row.paid_by_source ? "" : "text-muted"}`}>{row.paid_by_source ?? 0}</td>}
                  {attributed && (
                    <td className={`px-1 ${row.revenue_by_source ? "" : "text-muted"}`}>
                      {row.revenue_by_source ? formatIdr(row.revenue_by_source) : "—"}
                    </td>
                  )}
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
