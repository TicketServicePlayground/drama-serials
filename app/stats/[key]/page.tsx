import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { apiFetch } from "@/lib/api";
import { formatIdr } from "@/lib/billing-types";
import { findSerial } from "@/lib/catalog";

// The team's view of the site's own visit counter; the key in the link is STATS_KEY on the server.
export const metadata: Metadata = { title: "Статистика", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

interface Totals { visitors: number; views: number; signed_in: number; signups: number; paid: number; revenue: number; sessions: number; returns: number }
interface Top { name: string; views: number; visitors: number }
interface Stats {
  timezone: string;
  today: Totals;
  yesterday: Totals;
  week: Totals;
  month: Totals;
  by_day: { day: string; visitors: number; views: number; signups: number; paid: number; sessions: number; returns: number }[];
  pages: Top[];
  referrers: Top[];
  utm: Top[];
  langs: Top[];
  devices: Top[];
  recent: { at: string; visitor: string; path: string; referrer: string; utm_source: string; lang: string; device: string; signed_in: boolean; returned: boolean }[];
}

const DEVICE: Record<string, string> = { mobile: "телефон", tablet: "планшет", desktop: "компьютер" };

function pageName(path: string): string {
  if (path === "/") return "Главная";
  const series = path.match(/^\/series\/([a-z0-9-]+)/);
  if (series) return findSerial(series[1], "ru")?.title ?? path;
  return path;
}

export default async function StatsPage({ params }: {
  params: Promise<{ key: string }>;
}) {
  const { key } = await params;
  // Everything as it is: test accounts and the team's visits are counted like anyone's.
  const { status, data } = await apiFetch<Stats>(`/stats?key=${encodeURIComponent(key)}`);
  if (status !== 200) notFound();

  const tz = data.timezone;
  const time = new Intl.DateTimeFormat("ru-RU", { timeZone: tz, day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  const dayFmt = new Intl.DateTimeFormat("ru-RU", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" });
  const now = new Intl.DateTimeFormat("ru-RU", { timeZone: tz, hour: "2-digit", minute: "2-digit" }).format(new Date());

  const periods: [string, Totals][] = [
    ["Сегодня", data.today],
    ["Вчера", data.yesterday],
    ["7 дней", data.week],
    ["30 дней", data.month],
  ];
  const lists: [string, Top[], (name: string) => string][] = [
    ["Страницы · 7 дней", data.pages, pageName],
    ["Откуда пришли · 7 дней", data.referrers, (n) => n],
    ["utm_source · 7 дней", data.utm, (n) => n],
    ["Язык · 7 дней", data.langs, (n) => n.toUpperCase()],
    ["Устройство · 7 дней", data.devices, (n) => DEVICE[n] ?? n],
  ];

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-6">
      <header className="mb-5 flex items-baseline justify-between gap-3">
        <h1 className="font-display text-xl font-extrabold">Посетители</h1>
        <span className="flex gap-3 text-xs text-muted">
          <a href={`/stats/${encodeURIComponent(key)}/funnel`} className="underline-offset-2 hover:underline">воронка →</a>
          <a href="" className="underline-offset-2 hover:underline">обновлено {now} WITA ↻</a>
        </span>
      </header>

      <section className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {periods.map(([label, t]) => (
          <div key={label} className="rounded-xl border border-border bg-surface p-3">
            <p className="text-xs text-muted">{label}</p>
            <p className="mt-1 text-2xl font-bold tabular-nums">{t.visitors}</p>
            <p className="text-xs text-muted">посетителей · {t.views} просм.</p>
            <p className="mt-1 text-xs tabular-nums">заходов {t.sessions} · повторных {t.returns}</p>
            <p className="mt-2 text-xs tabular-nums">
              рег. {t.signups} · опл. {t.paid}
              {t.revenue > 0 && <span className="text-muted"> · {formatIdr(t.revenue)}</span>}
            </p>
          </div>
        ))}
      </section>

      <section className="mt-6">
        <h2 className="mb-2 text-sm font-semibold">По дням</h2>
        <table className="w-full text-sm tabular-nums">
          <thead className="text-xs text-muted">
            <tr className="text-right">
              <th className="py-1 text-left font-normal">день</th>
              <th className="font-normal">посет.</th>
              <th className="font-normal">заходы</th>
              <th className="font-normal">повт.</th>
              <th className="font-normal">просм.</th>
              <th className="font-normal">рег.</th>
              <th className="font-normal">опл.</th>
            </tr>
          </thead>
          <tbody>
            {data.by_day.map((d) => (
              <tr key={d.day} className={`border-t border-border text-right ${d.views === 0 ? "text-muted" : ""}`}>
                <td className="py-1.5 text-left">{dayFmt.format(new Date(d.day))}</td>
                <td>{d.visitors}</td>
                <td>{d.sessions}</td>
                <td>{d.returns}</td>
                <td>{d.views}</td>
                <td>{d.signups}</td>
                <td>{d.paid}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <div className="mt-6 grid gap-6 sm:grid-cols-2">
        {lists.map(([title, rows, name]) => (
          <section key={title}>
            <h2 className="mb-2 text-sm font-semibold">{title}</h2>
            {rows.length === 0 ? (
              <p className="text-xs text-muted">пока пусто</p>
            ) : (
              <ul className="text-sm">
                {rows.map((r) => (
                  <li key={r.name} className="flex justify-between gap-3 border-t border-border py-1.5">
                    <span className="truncate">{name(r.name)}</span>
                    <span className="shrink-0 tabular-nums text-muted">
                      {r.visitors} · {r.views}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))}
      </div>

      <section className="mt-6">
        <h2 className="mb-1 text-sm font-semibold">Последние просмотры</h2>
        <p className="mb-2 text-xs text-muted">метка = один посетитель за день · ● вошёл в аккаунт · ↻ повторный заход</p>
        {data.recent.length === 0 ? (
          <p className="text-xs text-muted">пока пусто</p>
        ) : (
          <ul className="text-sm">
            {data.recent.map((v, i) => (
              <li key={i} className="border-t border-border py-1.5">
                <div className="flex justify-between gap-3">
                  <span className="truncate">
                    {v.signed_in && <span className="text-success">● </span>}
                    {v.returned && <span className="text-accent">↻ </span>}
                    {pageName(v.path)}
                  </span>
                  <span className="shrink-0 text-xs tabular-nums text-muted">{time.format(new Date(v.at))}</span>
                </div>
                <p className="text-xs text-muted">
                  <span className="font-mono">{v.visitor.slice(0, 4)}</span> · {DEVICE[v.device] ?? v.device}
                  {v.lang && ` · ${v.lang.toUpperCase()}`}
                  {v.referrer && ` · из ${v.referrer}`}
                  {v.utm_source && ` · utm ${v.utm_source}`}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="mt-8 text-xs text-muted">
        Свой счётчик сайта, без cookie. Боты по User-Agent отсеяны; скрипты-сканеры с обычным браузером могут
        попадать. Числа справа в списках: посетители · просмотры. Заход — просмотры одного человека без
        перерыва дольше 30 минут; повторный — заход того, кто уже был на сайте (в тот же день или раньше).
        Возврат в другой день виден с 20 ноября: до этого счётчик не умел узнавать человека на следующий день.
      </p>
    </main>
  );
}
