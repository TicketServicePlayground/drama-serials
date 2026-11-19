"use client";

import { formatCount, getDictionary, type Locale } from "@/lib/i18n";
import { EyeIcon, HeartIcon } from "./icons";

/** Views counter plus a like toggle. `liked` adds the viewer's own like to the count. */
export function Stats({ locale, views, likes, liked, onLike, size = "sm" }: {
  locale: Locale;
  views: number;
  likes: number;
  liked: boolean;
  onLike: () => void;
  size?: "sm" | "md";
}) {
  const t = getDictionary(locale);
  const text = size === "sm" ? "text-xs" : "text-sm";
  const icon = size === "sm" ? "size-4" : "size-5";
  return (
    <div className={`flex items-center gap-3 ${text} text-muted`}>
      <span className="flex items-center gap-1" title={t.views}>
        <EyeIcon className={icon} />
        <span>{formatCount(views, locale)}</span>
        <span className="sr-only">{t.views}</span>
      </span>
      <button
        type="button"
        aria-pressed={liked}
        aria-label={`${liked ? t.unlike : t.like} · ${formatCount(likes + (liked ? 1 : 0), locale)} ${t.likes}`}
        onClick={onLike}
        className={`-m-1 flex cursor-pointer items-center gap-1 rounded-md p-1 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-focus ${
          liked ? "text-accent" : "hover:text-foreground"
        }`}
      >
        <HeartIcon filled={liked} className={`${icon} transition-transform active:scale-125`} />
        {likes + (liked ? 1 : 0) > 0 && <span>{formatCount(likes + (liked ? 1 : 0), locale)}</span>}
      </button>
    </div>
  );
}
