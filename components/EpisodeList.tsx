"use client";

import { useState } from "react";
import type { Episode } from "@/lib/catalog";
import { formatDuration } from "@/lib/billing-types";
import { getDictionary, type Locale } from "@/lib/i18n";
import { CdnImage } from "./CdnImage";
import { ChevronIcon, LockIcon } from "./icons";
import { Stats } from "./Stats";

function PlayGlyph({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={className} fill="currentColor">
      <path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.6-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5Z" />
    </svg>
  );
}

function EpisodeCard({ episode, locale, liked, locked, free, priority, onLike, onPlay }: {
  episode: Episode;
  locale: Locale;
  liked: boolean;
  locked: boolean;
  /** Free for everyone (shown as a badge instead of the lock). */
  free: boolean;
  priority: boolean;
  onLike: () => void;
  onPlay: () => void;
}) {
  const t = getDictionary(locale);
  const [open, setOpen] = useState(false);
  // Frames from vertical videos sit beside the text instead of being cropped to a thin strip.
  const portrait = !!episode.image && episode.image.height > episode.image.width;
  return (
    <li className={`overflow-hidden rounded-xl bg-surface ${portrait ? "flex" : "sm:flex"}`}>
      <button
        type="button"
        onClick={onPlay}
        aria-label={`${t.player.play(episode.number)} · ${episode.title} · ${formatDuration(episode.duration)}`}
        className={`group relative block shrink-0 cursor-pointer overflow-hidden bg-surface-secondary outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-inset ${
          portrait ? "aspect-[9/16] w-32 self-start sm:w-40" : "aspect-video w-full sm:w-72"
        }`}
      >
        <CdnImage
          image={episode.image}
          priority={priority}
          sizes={portrait ? "160px" : "(min-width: 640px) 288px, 100vw"}
          className="size-full object-cover transition-transform duration-300 group-hover:scale-[1.04]"
        />
        <span aria-hidden className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-black/20" />
        <span className="absolute top-2 left-2 rounded-md bg-black/65 px-2 py-0.5 text-xs font-medium text-white backdrop-blur">
          {t.series.episode(episode.number)}
        </span>
        {locked && (
          <span className="absolute top-2 right-2 flex size-7 items-center justify-center rounded-full bg-black/65 text-white backdrop-blur">
            <LockIcon className="size-4" />
          </span>
        )}
        {free && (
          <span className="absolute top-2 right-2 rounded-md bg-success px-2 py-0.5 text-xs font-semibold text-white">
            {t.series.free}
          </span>
        )}
        <span
          aria-hidden
          className={`absolute top-1/2 left-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-black shadow-2xl ring-4 ring-white/25 transition-transform duration-200 group-hover:scale-110 group-active:scale-95 ${
            portrait ? "size-14" : "size-16 sm:size-[4.5rem]"
          }`}
        >
          <PlayGlyph className={portrait ? "ml-0.5 size-7" : "ml-1 size-8 sm:size-9"} />
        </span>
        <span className="absolute right-2 bottom-2 rounded-md bg-black/75 px-1.5 py-0.5 font-mono text-xs font-medium text-white tabular-nums">
          {formatDuration(episode.duration)}
        </span>
      </button>
      <div className={`flex min-w-0 flex-1 flex-col items-start gap-2 ${portrait ? "p-3 sm:p-4" : "p-4"}`}>
        <h3 className="text-base font-semibold text-foreground">{episode.title}</h3>
        {episode.headline && <p className="text-sm leading-5 font-medium text-foreground/85">{episode.headline}</p>}
        <p className={`text-sm leading-6 text-muted ${open ? "" : portrait ? "line-clamp-2" : "line-clamp-1"}`}>
          {episode.description}
        </p>
        <div className="mt-auto flex w-full items-center justify-between gap-3">
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
            className="-ml-1 flex cursor-pointer items-center gap-1 rounded-md px-1 text-sm text-accent outline-none focus-visible:ring-2 focus-visible:ring-focus"
          >
            {open ? t.series.less : t.series.more}
            <ChevronIcon className={`size-4 transition-transform ${open ? "rotate-180" : ""}`} />
          </button>
          <Stats locale={locale} views={episode.views} likes={episode.likes} liked={liked} onLike={onLike} />
        </div>
      </div>
    </li>
  );
}

export function EpisodeList({ episodes, locale, likes, isLocked, isFree, onLike, onPlay }: {
  episodes: Episode[];
  locale: Locale;
  likes: Set<string>;
  isLocked: (episode: Episode) => boolean;
  isFree?: (episode: Episode) => boolean;
  onLike: (id: string) => void;
  onPlay: (episode: Episode) => void;
}) {
  return (
    <ol className="flex flex-col gap-3">
      {episodes.map((episode) => (
        <EpisodeCard
          key={episode.id}
          episode={episode}
          locale={locale}
          liked={likes.has(episode.id)}
          locked={isLocked(episode)}
          free={isFree?.(episode) ?? false}
          priority={episode.number === 1}
          onLike={() => onLike(episode.id)}
          onPlay={() => onPlay(episode)}
        />
      ))}
    </ol>
  );
}
