"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@heroui/react";
import { getDictionary, type Locale } from "@/lib/i18n";
import { CrownIcon } from "./icons";
import { LocalDate } from "./LocalDate";

export interface PointsState {
  balance: number;
  earned_today: boolean;
  daily: number;
  per_vip_day: number;
  history: { at: string; delta: number; reason: string }[];
}

/** VIP points on the profile page: balance, today's award, exchange for a VIP day. */
export function PointsCard({ locale, points, isVip }: { locale: Locale; points: PointsState; isVip: boolean }) {
  const t = getDictionary(locale).vipExtras;
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string }>();
  const enough = points.balance >= points.per_vip_day;

  async function redeem() {
    setPending(true);
    setMessage(undefined);
    try {
      const response = await fetch("/api/points/redeem", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ days: 1 }),
      });
      if (!response.ok) throw new Error();
      setMessage({ ok: true, text: t.redeemed });
      router.refresh();
    } catch {
      setMessage({ ok: false, text: t.redeemError });
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="mt-4 rounded-2xl bg-surface p-4">
      <div className="flex items-baseline justify-between gap-3">
        <p className="flex items-center gap-1.5 text-sm font-semibold text-gold">
          <CrownIcon className="size-4" />
          {t.pointsTitle}
        </p>
        <p className="text-2xl font-bold tabular-nums">{points.balance.toLocaleString(locale)}</p>
      </div>
      <p className="mt-1 text-xs text-muted">
        {points.earned_today ? t.earnedToday(points.daily) : isVip ? t.earnHint(points.daily) : t.earnHintNoVip(points.daily)}
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button size="sm" variant="secondary" isDisabled={!enough || pending} onPress={redeem}>
          {t.redeem(points.per_vip_day)}
        </Button>
        {!enough && <span className="text-xs text-muted">{t.needMore(points.per_vip_day - points.balance)}</span>}
      </div>
      {message && <p className={`mt-2 text-sm ${message.ok ? "text-success" : "text-danger"}`}>{message.text}</p>}
      {points.history.length > 0 && (
        <ul className="mt-3 flex flex-col text-xs">
          {points.history.slice(0, 7).map((entry) => (
            <li key={entry.at} className="flex justify-between gap-3 border-t border-border py-1.5">
              <span className="text-muted">
                <LocalDate iso={entry.at} locale={locale} /> · {t.reason[entry.reason] ?? entry.reason}
              </span>
              <span className={`tabular-nums ${entry.delta > 0 ? "text-success" : ""}`}>
                {entry.delta > 0 ? `+${entry.delta}` : entry.delta}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
