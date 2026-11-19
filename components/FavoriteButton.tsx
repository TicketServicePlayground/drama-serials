"use client";

import { getDictionary, type Locale } from "@/lib/i18n";
import { BookmarkFilledIcon, BookmarkIcon } from "./icons";

export function FavoriteButton({ locale, active, onToggle, className = "" }: {
  locale: Locale;
  active: boolean;
  onToggle: () => void;
  className?: string;
}) {
  const t = getDictionary(locale);
  const Icon = active ? BookmarkFilledIcon : BookmarkIcon;
  return (
    <button
      type="button"
      aria-pressed={active}
      aria-label={active ? t.removeFromList : t.addToList}
      title={active ? t.removeFromList : t.addToList}
      onClick={onToggle}
      className={`flex size-9 cursor-pointer items-center justify-center rounded-full bg-black/55 text-white outline-none backdrop-blur transition hover:bg-black/70 focus-visible:ring-2 focus-visible:ring-focus active:scale-90 ${
        active ? "text-gold" : ""
      } ${className}`}
    >
      <Icon className="size-5" />
    </button>
  );
}
