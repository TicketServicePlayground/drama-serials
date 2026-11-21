import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { apiFetch } from "@/lib/api";

// Raw rows of the site's tables, as they are in the database; the key in the link is STATS_KEY.
// Nothing is counted or merged here: every column, every row, times in UTC as stored.
export const metadata: Metadata = { title: "Данные", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

type Cell = string | number | boolean | null;
interface Raw {
  table: string;
  tables: string[];
  from: string;
  to: string;
  page: number;
  page_size: number;
  total: number;
  columns: string[];
  rows: Cell[][];
}

const TITLES: Record<string, string> = {
  visits: "Визиты",
  users: "Пользователи",
  payments: "Платежи",
  access_grants: "Доступы",
  episode_unlocks: "Купленные серии",
};
const DAY = /^\d{4}-\d{2}-\d{2}$/;

function show(value: Cell): string {
  if (value === null) return "";
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value);
}

export default async function RawPage({ params, searchParams }: {
  params: Promise<{ key: string }>;
  searchParams: Promise<{ table?: string; from?: string; to?: string; page?: string }>;
}) {
  const [{ key }, query] = await Promise.all([params, searchParams]);
  const table = query.table ?? "visits";
  const from = query.from && DAY.test(query.from) ? query.from : "";
  const to = query.to && DAY.test(query.to) ? query.to : "";
  const page = Math.max(1, Number(query.page) || 1);
  const qs = (extra: Record<string, string | number>) =>
    new URLSearchParams(
      Object.entries({ table, from, to, ...extra })
        .filter(([, v]) => v !== "")
        .map(([k, v]) => [k, String(v)]),
    ).toString();

  const { status, data } = await apiFetch<Raw>(`/raw?key=${encodeURIComponent(key)}&${qs({ page })}`);
  if (status === 404) notFound();
  if (status !== 200) {
    return <main className="p-4 text-sm">Ошибка {status}: {data.error}</main>;
  }

  const base = `/stats/${encodeURIComponent(key)}`;
  const pages = Math.max(1, Math.ceil(data.total / data.page_size));
  const first = (data.page - 1) * data.page_size;

  return (
    <main className="w-full px-4 py-4">
      <nav className="flex flex-wrap gap-2 text-sm">
        {data.tables.map((t) => (
          <a
            key={t}
            href={`${base}?${new URLSearchParams({ table: t, ...(from && { from }), ...(to && { to }) })}`}
            className={`rounded-lg border px-3 py-1.5 ${t === data.table ? "border-accent bg-accent text-accent-foreground" : "border-border"}`}
          >
            {TITLES[t] ?? t} <span className="font-mono text-xs opacity-70">{t}</span>
          </a>
        ))}
      </nav>

      <form method="get" action={base} className="mt-3 flex flex-wrap items-end gap-3 text-sm">
        <input type="hidden" name="table" value={data.table} />
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted">с (UTC)</span>
          <input type="date" name="from" defaultValue={data.from} className="rounded-lg border border-border bg-surface px-2 py-1" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted">по (UTC, включительно)</span>
          <input type="date" name="to" defaultValue={data.to} className="rounded-lg border border-border bg-surface px-2 py-1" />
        </label>
        <button type="submit" className="cursor-pointer rounded-lg border border-border px-3 py-1.5">Показать</button>
        <a href={`${base}/csv?${new URLSearchParams({ table: data.table, from: data.from, to: data.to })}`} className="rounded-lg border border-border px-3 py-1.5">
          Скачать CSV (весь период)
        </a>
      </form>

      <p className="mt-3 text-xs text-muted tabular-nums">
        {data.table} · {data.from} — {data.to} UTC · строк: {data.total}
        {data.total > 0 && ` · показаны ${first + 1}–${first + data.rows.length}, новые сверху`}
      </p>

      <div className="mt-2 overflow-x-auto">
        <table className="min-w-full border-collapse font-mono text-xs">
          <thead>
            <tr>
              {data.columns.map((c) => (
                <th key={c} className="sticky top-0 whitespace-nowrap border border-border bg-surface px-2 py-1 text-left font-semibold">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.rows.map((row, i) => (
              <tr key={i} className="odd:bg-surface-secondary/40">
                {row.map((cell, j) => {
                  const text = show(cell);
                  return (
                    <td key={j} title={text.length > 80 ? text : undefined} className="max-w-[28rem] truncate whitespace-nowrap border border-border px-2 py-0.5">
                      {text}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {pages > 1 && (
        <nav className="mt-3 flex flex-wrap gap-2 text-sm tabular-nums">
          {Array.from({ length: pages }, (_, i) => i + 1).map((n) => (
            <a key={n} href={`${base}?${qs({ page: n })}`} className={`rounded border px-2 py-0.5 ${n === data.page ? "border-accent" : "border-border"}`}>
              {n}
            </a>
          ))}
        </nav>
      )}
    </main>
  );
}
