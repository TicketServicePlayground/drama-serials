"use client";

import { formatDuration } from "@/lib/billing-types";
import type { SerialCard } from "@/lib/catalog";
import { getDictionary, type Locale } from "@/lib/i18n";
import { CdnImage } from "./CdnImage";
import { FavoriteButton } from "./FavoriteButton";
import { ClockIcon, CrownIcon, FilmIcon } from "./icons";
import { Stats } from "./Stats";

/** One tile of the showcase grid: cover + title open the series; bookmark and like act in place. */
export function CoverCard({ serial, locale, favorite, liked, priority, onOpen, onLike, onToggleFavorite }: {
  serial: SerialCard;
  priority: boolean;
  locale: Locale;
  favorite: boolean;
  liked: boolean;
  onOpen: () => void;
  onLike: () => void;
  onToggleFavorite: () => void;
}) {
  const t = getDictionary(locale);
  return (
    <article className="group relative flex flex-col overflow-hidden rounded-xl bg-surface transition-transform duration-200 hover:-translate-y-0.5">
      <button
        type="button"
        onClick={onOpen}
        className="flex cursor-pointer flex-col text-left outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-inset"
      >
        <span className="relative block aspect-[2/3] w-full overflow-hidden bg-surface-secondary">
          <CdnImage
            image={serial.cover}
            priority={priority}
            sizes="(min-width: 1152px) 216px, (min-width: 1024px) 20vw, (min-width: 768px) 25vw, (min-width: 640px) 33vw, 50vw"
            className="size-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
          />
          <span className="absolute top-0 right-0 rounded-bl-lg bg-tag px-2 py-0.5 text-xs font-medium text-white">
            {t.tag[serial.tag]}
          </span>
          {serial.vip && (
            <span className="absolute top-7 right-0 flex items-center gap-1 rounded-l-lg bg-gold px-2 py-0.5 text-xs font-bold text-black">
              <CrownIcon className="size-3.5" />
              {t.tag.vip}
            </span>
          )}
          <span className="absolute inset-x-0 bottom-0 flex items-center gap-2.5 bg-gradient-to-t from-black/85 to-transparent px-2.5 pt-6 pb-2 text-xs font-medium text-white">
            <span className="flex items-center gap-1" title={t.card.episodesLong(serial.episodeCount)}>
              <FilmIcon className="size-3.5" />
              {t.card.episodes(serial.episodeCount)}
            </span>
            <span className="flex items-center gap-1" title={t.card.avg}>
              <ClockIcon className="size-3.5" />
              <span className="sr-only">{t.card.avg}:</span>~{formatDuration(serial.avgDuration)}
            </span>
          </span>
        </span>
        <span className="px-2.5 pt-2.5">
          <span className="line-clamp-2 min-h-10 text-sm leading-5 text-foreground">{serial.title}</span>
        </span>
      </button>
      <FavoriteButton locale={locale} active={favorite} onToggle={onToggleFavorite} className="absolute top-2 left-2" />
      <div className="flex flex-1 flex-col items-start gap-2 px-2.5 pt-2 pb-3">
        <span className="rounded-md bg-gold-soft px-2 py-0.5 text-xs text-gold">{t.rank(serial.rank)}</span>
        <Stats locale={locale} views={serial.views} likes={serial.likes} liked={liked} onLike={onLike} />
      </div>
    </article>
  );
}
