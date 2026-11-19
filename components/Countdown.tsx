"use client";

import { useEffect, useState } from "react";

function left(until: number) {
  return Math.max(0, Math.floor((until - Date.now()) / 1000));
}

/** hh:mm:ss down to a server-given deadline; calls onEnd once at zero. */
export function Countdown({ until, onEnd }: { until: string; onEnd?: () => void }) {
  const deadline = new Date(until).getTime();
  const [seconds, setSeconds] = useState(() => left(deadline));
  useEffect(() => {
    const timer = setInterval(() => {
      const next = left(deadline);
      setSeconds(next);
      if (next === 0) {
        clearInterval(timer);
        onEnd?.();
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [deadline, onEnd]);
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    <span className="font-mono tabular-nums" role="timer">
      {pad(Math.floor(seconds / 3600))}:{pad(Math.floor((seconds % 3600) / 60))}:{pad(seconds % 60)}
    </span>
  );
}
