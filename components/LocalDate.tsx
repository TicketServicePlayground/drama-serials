"use client";

import { useEffect, useState } from "react";
import type { Locale } from "@/lib/i18n";

/** Date and time in the viewer's own time zone; rendered after mount to avoid a server/browser mismatch. */
export function LocalDate({ iso, locale }: { iso: string; locale: Locale }) {
  const [text, setText] = useState("");
  useEffect(() => {
    setText(new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso)));
  }, [iso, locale]);
  return <time dateTime={iso}>{text}</time>;
}
