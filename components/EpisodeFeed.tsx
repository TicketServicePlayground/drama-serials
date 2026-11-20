"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Spinner } from "@heroui/react";
import type { Episode } from "@/lib/catalog";
import { getDictionary, type Locale } from "@/lib/i18n";
import { ChevronIcon, CloseIcon, CrownIcon, LockIcon } from "./icons";

interface Source {
  url: string;
  /** The lighter 480p copy, when one has been made. */
  sdUrl: string | null;
  points: number;
}

type Load =
  | { kind: "loading" }
  | { kind: "ready"; source: Source }
  | { kind: "locked" }
  | { kind: "notReady" }
  | { kind: "error" };

/** "sd" is the lighter 480p copy; "auto" picks it on a slow connection or after the video stalls. */
type Quality = "auto" | "hd" | "sd";
const QUALITY_KEY = "player-quality";
const HINT_KEY = "feed-swipe-hint";
// Stalls (after playback started) that make "auto" drop to the lighter copy.
const STALLS_BEFORE_SD = 2;

function stored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function store(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Private mode: remembered until the page closes.
  }
}

function savedQuality(): Quality {
  const value = stored(QUALITY_KEY);
  return value === "hd" || value === "sd" ? value : "auto";
}

/** Data saver on, or a connection too slow for the full-quality file (~3-4 Mbit/s). */
function slowConnection(): boolean {
  if (typeof navigator === "undefined") return false;
  const connection = (navigator as Navigator & {
    connection?: { saveData?: boolean; effectiveType?: string; downlink?: number };
  }).connection;
  if (!connection) return false;
  return (
    Boolean(connection.saveData) ||
    ["slow-2g", "2g", "3g"].includes(connection.effectiveType ?? "") ||
    (typeof connection.downlink === "number" && connection.downlink > 0 && connection.downlink < 5)
  );
}

async function fetchSource(slug: string, episode: number, locale: Locale): Promise<Load> {
  try {
    const response = await fetch(`/api/play/${slug}/${episode}?lang=${locale}`, { cache: "no-store" });
    if (response.status === 402 || response.status === 401 || response.status === 403) return { kind: "locked" };
    if (response.status === 404) return { kind: "notReady" };
    const data = await response.json();
    if (!response.ok || !data.url) return { kind: "error" };
    return { kind: "ready", source: { url: data.url, sdUrl: data.sd_url ?? null, points: data.points_awarded ?? 0 } };
  } catch {
    return { kind: "error" };
  }
}

const SpeakerOffIcon = ({ className = "" }: { className?: string }) => (
  <svg viewBox="0 0 24 24" aria-hidden className={className} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <path d="M11 5 6 9H2v6h4l5 4V5Z" />
    <path d="m23 9-6 6M17 9l6 6" />
  </svg>
);

const PlayGlyph = ({ className = "" }: { className?: string }) => (
  <svg viewBox="0 0 24 24" aria-hidden className={className} fill="currentColor">
    <path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.6-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5Z" />
  </svg>
);

/**
 * Episodes of one series as a full-screen vertical feed: swipe (or scroll, or arrow keys) to
 * the next one, and the next one starts by itself when an episode ends. One <video> element
 * plays every episode, so a browser that allowed sound once keeps allowing it.
 * Episodes that need paying show a lock and open the paywall (`onLocked`) on top of the feed.
 */
export function EpisodeFeed(props: {
  locale: Locale;
  slug: string;
  seriesTitle: string;
  episodes: Episode[];
  /** Episode number to open at; null = closed. */
  start: number | null;
  isLocked: (episode: Episode) => boolean;
  onClose: () => void;
  /** Reached an episode that needs paying for (or an email: `needsEmail`). */
  onLocked: (episode: Episode) => void;
  /** Locked episodes that open for an email rather than a payment: their button says so. */
  needsEmail?: (episode: Episode) => boolean;
  /** An episode started playing. */
  onWatch?: (episode: Episode) => void;
  /** The last episode played to the end. */
  onFinished?: (episode: Episode) => void;
}) {
  if (props.start === null) return null;
  return <Feed {...props} start={props.start} />;
}

function Feed({ locale, slug, seriesTitle, episodes, start, isLocked, onClose, onLocked, needsEmail, onWatch, onFinished }: {
  locale: Locale;
  slug: string;
  seriesTitle: string;
  episodes: Episode[];
  start: number;
  isLocked: (episode: Episode) => boolean;
  onClose: () => void;
  onLocked: (episode: Episode) => void;
  needsEmail?: (episode: Episode) => boolean;
  onWatch?: (episode: Episode) => void;
  onFinished?: (episode: Episode) => void;
}) {
  const t = getDictionary(locale);
  const scroller = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const [index, setIndex] = useState(() => Math.max(0, episodes.findIndex((e) => e.number === start)));
  // The feed is between two episodes: the video hides and the frames scroll by.
  const [moving, setMoving] = useState(false);
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [quality, setQuality] = useState<Quality>(savedQuality);
  const [autoSd, setAutoSd] = useState(slowConnection);
  const [paused, setPaused] = useState(false);
  const [muted, setMuted] = useState(false);
  const [time, setTime] = useState({ at: 0, of: 0 });
  const [points, setPoints] = useState(0);
  const [hint, setHint] = useState(false);
  const resumeAt = useRef(0);
  const stalls = useRef({ started: false, count: 0 });
  const settleTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // Next episodes' addresses, asked for in advance so swiping on starts at once.
  const prefetched = useRef(new Map<number, Promise<Load>>());

  const episode = episodes[index];
  const locked = isLocked(episode);
  const next = episodes[index + 1];

  // Open at the chosen episode; keep the page behind from scrolling.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = index * el.clientHeight;
    const root = document.documentElement;
    const overflow = root.style.overflow;
    root.style.overflow = "hidden";
    return () => {
      root.style.overflow = overflow;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Rotating the phone changes the slide height: stay on the same episode.
  useEffect(() => {
    const align = () => {
      const el = scroller.current;
      if (el) el.scrollTop = index * el.clientHeight;
    };
    window.addEventListener("resize", align);
    return () => window.removeEventListener("resize", align);
  }, [index]);

  const go = useCallback((to: number) => {
    const el = scroller.current;
    if (!el || to < 0 || to >= episodes.length) return;
    el.scrollTo({ top: to * el.clientHeight, behavior: "smooth" });
  }, [episodes.length]);

  // Mouse wheel and trackpad: one gesture, one episode (a free scroll would snap back halfway).
  const wheel = useRef<{ locked: boolean; timer?: ReturnType<typeof setTimeout> }>({ locked: false });
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const onWheel = (event: WheelEvent) => {
      if (Math.abs(event.deltaY) < 4) return;
      event.preventDefault();
      clearTimeout(wheel.current.timer);
      // A trackpad keeps sending events while the swipe coasts: wait for a pause.
      wheel.current.timer = setTimeout(() => (wheel.current.locked = false), 250);
      if (wheel.current.locked) return;
      wheel.current.locked = true;
      go(index + Math.sign(event.deltaY));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [index, go]);

  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    setMoving(Math.abs(el.scrollTop - index * el.clientHeight) > 8);
    clearTimeout(settleTimer.current);
    settleTimer.current = setTimeout(() => {
      const settled = Math.round(el.scrollTop / el.clientHeight);
      setMoving(false);
      setIndex(Math.min(Math.max(settled, 0), episodes.length - 1));
    }, 120);
  };

  // The episode in view: fetch its address and play it, or show the lock.
  useEffect(() => {
    let cancelled = false;
    resumeAt.current = 0;
    stalls.current = { started: false, count: 0 };
    setTime({ at: 0, of: 0 });
    setPaused(false);
    video.current?.pause();
    if (locked) {
      setLoad({ kind: "locked" });
      onLocked(episode);
      return;
    }
    setLoad({ kind: "loading" });
    const pending = prefetched.current.get(episode.number) ?? fetchSource(slug, episode.number, locale);
    prefetched.current.delete(episode.number);
    pending.then((result) => {
      if (cancelled) return;
      setLoad(result);
      if (result.kind === "locked") onLocked(episode);
      if (result.kind === "ready") {
        onWatch?.(episode);
        if (result.source.points > 0) setPoints(result.source.points);
      }
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, locked]);

  // While one episode plays, ask for the next one's address.
  useEffect(() => {
    if (load.kind !== "ready" || !next || isLocked(next) || prefetched.current.has(next.number)) return;
    const result = fetchSource(slug, next.number, locale);
    prefetched.current.set(next.number, result);
    // A failed answer is asked again when the episode comes into view.
    result.then((r) => r.kind !== "ready" && prefetched.current.delete(next.number));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load.kind, next?.number]);

  // First time in the feed: show that swiping up goes on.
  useEffect(() => {
    if (load.kind !== "ready" || !next || stored(HINT_KEY)) return;
    setHint(true);
    store(HINT_KEY, "1");
    const timer = setTimeout(() => setHint(false), 4000);
    return () => clearTimeout(timer);
  }, [load.kind, next]);

  useEffect(() => {
    if (!points) return;
    const timer = setTimeout(() => setPoints(0), 4000);
    return () => clearTimeout(timer);
  }, [points]);

  const source = load.kind === "ready" ? load.source : null;
  const shown: "hd" | "sd" = source?.sdUrl && (quality === "sd" || (quality === "auto" && autoSd)) ? "sd" : "hd";
  const src = source ? (shown === "sd" && source.sdUrl ? source.sdUrl : source.url) : undefined;

  const play = useCallback(() => {
    const v = video.current;
    if (!v) return;
    v.play().catch((error: DOMException) => {
      // No sound without a tap first (iOS, some browsers): play muted and offer the sound.
      if (error.name === "NotAllowedError" && !v.muted) {
        v.muted = true;
        setMuted(true);
        v.play().catch(() => setPaused(true));
      }
    });
  }, []);

  const toggle = () => {
    const v = video.current;
    if (!v || !source) return;
    if (v.paused) play();
    else v.pause();
  };

  const unmute = () => {
    const v = video.current;
    if (!v) return;
    v.muted = false;
    setMuted(false);
    if (v.paused) play();
  };

  const switchTo = (value: Quality) => {
    resumeAt.current = video.current?.currentTime ?? 0;
    setQuality(value);
    store(QUALITY_KEY, value);
  };

  // "auto" on the full file keeps stalling: continue from the same second in the lighter copy.
  const onWaiting = () => {
    if (quality !== "auto" || shown === "sd" || !source?.sdUrl || !stalls.current.started) return;
    stalls.current.count += 1;
    if (stalls.current.count >= STALLS_BEFORE_SD) {
      resumeAt.current = video.current?.currentTime ?? 0;
      setAutoSd(true);
    }
  };

  const onEnded = () => {
    if (next) go(index + 1);
    else onFinished?.(episode);
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // The paywall or sign-in dialog on top takes the keys.
      if (document.querySelector("[role=dialog][aria-modal=true]:not([data-feed])")) return;
      if (event.key === "Escape") onClose();
      else if (event.key === "ArrowDown" || event.key === "PageDown") go(index + 1);
      else if (event.key === "ArrowUp" || event.key === "PageUp") go(index - 1);
      else if (event.key === " ") {
        event.preventDefault();
        toggle();
      } else return;
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <div
      role="dialog"
      aria-modal="true"
      data-feed
      aria-label={`${seriesTitle} · ${t.series.episode(episode.number)}`}
      className="fixed inset-0 z-40 bg-black text-white"
    >
      <div
        ref={scroller}
        onScroll={onScroll}
        className="scrollbar-none h-full snap-y snap-mandatory overflow-y-scroll overscroll-contain"
      >
        {episodes.map((item, i) => (
          <section
            key={item.id}
            onClick={i === index ? toggle : undefined}
            className="relative flex h-full snap-start snap-always items-center justify-center"
          >
            {/* Only nearby frames load; the rest are black until they come close. */}
            {item.image && Math.abs(i - index) <= 2 && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={item.image.src}
                alt=""
                className={`absolute inset-0 size-full object-contain ${isLocked(item) ? "opacity-40 blur-sm" : ""}`}
              />
            )}
          </section>
        ))}
      </div>

      {/* Always the same element: the browser's go-ahead for sound stays with it. */}
      <video
          ref={video}
          src={src}
          playsInline
          preload="auto"
          controlsList="nodownload"
          onLoadedMetadata={(event) => {
            if (resumeAt.current > 0) event.currentTarget.currentTime = resumeAt.current;
            play();
          }}
          onPlaying={() => {
            stalls.current.started = true;
            setPaused(false);
          }}
          onPause={() => setPaused(true)}
          onWaiting={onWaiting}
          onTimeUpdate={(event) => setTime({ at: event.currentTarget.currentTime, of: event.currentTarget.duration || 0 })}
          onEnded={onEnded}
          className={`pointer-events-none absolute inset-0 size-full object-contain transition-opacity duration-150 ${moving || !src ? "opacity-0" : "opacity-100"}`}
        />

      {/* Controls: only the buttons catch taps, the rest goes to the feed below. */}
      <div className={`pointer-events-none absolute inset-0 mx-auto flex max-w-lg flex-col transition-opacity ${moving ? "opacity-0" : "opacity-100"}`}>
        <div className="flex items-start gap-3 bg-gradient-to-b from-black/60 to-transparent p-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
          <button
            type="button"
            onClick={onClose}
            aria-label={t.player.close}
            className="pointer-events-auto flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-full bg-black/40 outline-none focus-visible:ring-2 focus-visible:ring-white"
          >
            <CloseIcon className="size-5" />
          </button>
          <div className="min-w-0 flex-1 pt-0.5">
            <p className="truncate text-sm font-semibold">{seriesTitle}</p>
            <p className="text-xs text-white/70">{t.player.of(episode.number, episodes.length)}</p>
          </div>
          {source?.sdUrl && (
            <div role="radiogroup" aria-label={t.player.quality} className="pointer-events-auto flex shrink-0 rounded-lg bg-black/45 p-0.5 text-xs font-medium">
              {(["auto", "hd", "sd"] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  role="radio"
                  aria-checked={quality === option}
                  title={option === "sd" ? t.player.saver : undefined}
                  onClick={() => switchTo(option)}
                  className={`cursor-pointer rounded-md px-2 py-1 outline-none focus-visible:ring-2 focus-visible:ring-white ${
                    quality === option ? "bg-white text-black" : "text-white/80"
                  }`}
                >
                  {option === "auto" ? `${t.player.auto}${quality === "auto" ? ` · ${shown === "sd" ? "480p" : "HD"}` : ""}` : option === "hd" ? "HD" : "480p"}
                </button>
              ))}
            </div>
          )}
        </div>

        {points > 0 && (
          <p className="mx-auto mt-1 flex items-center gap-1.5 rounded-lg bg-black/60 px-3 py-1.5 text-sm font-semibold text-gold">
            <CrownIcon className="size-4" />
            {t.vipExtras.toast(points)}
          </p>
        )}

        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
          {load.kind === "loading" && <Spinner size="lg" />}
          {load.kind === "ready" && paused && !muted && (
            <span className="flex size-16 items-center justify-center rounded-full bg-black/45">
              <PlayGlyph className="ml-1 size-8" />
            </span>
          )}
          {load.kind === "ready" && muted && (
            <button
              type="button"
              onClick={unmute}
              className="pointer-events-auto flex cursor-pointer items-center gap-2 rounded-full bg-black/60 px-4 py-2 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-white"
            >
              <SpeakerOffIcon className="size-5" />
              {t.player.unmute}
            </button>
          )}
          {load.kind === "locked" && (
            <>
              <span className="flex size-14 items-center justify-center rounded-full bg-black/55">
                <LockIcon className="size-7" />
              </span>
              <button
                type="button"
                onClick={() => onLocked(episode)}
                className="pointer-events-auto flex cursor-pointer items-center gap-2 rounded-xl bg-gradient-to-r from-accent to-tag px-5 py-3 font-semibold text-accent-foreground shadow-lg outline-none focus-visible:ring-2 focus-visible:ring-white"
              >
                {needsEmail?.(episode) ? (
                  t.emailGate.cta
                ) : (
                  <>
                    <CrownIcon className="size-5" />
                    {t.player.unlock}
                  </>
                )}
              </button>
            </>
          )}
          {(load.kind === "notReady" || load.kind === "error") && (
            <p className="max-w-xs rounded-lg bg-black/60 px-4 py-2 text-sm font-medium">
              {load.kind === "notReady" ? t.player.notReady : t.player.error}
            </p>
          )}
        </div>

        <div className="bg-gradient-to-t from-black/75 via-black/40 to-transparent px-4 pt-10 pb-[max(1rem,env(safe-area-inset-bottom))]">
          {hint && (
            <p className="mb-3 flex animate-bounce items-center justify-center gap-1 text-sm font-medium">
              <ChevronIcon className="size-4 rotate-180" />
              {t.player.swipe}
            </p>
          )}
          <h2 className="text-base font-semibold">{episode.title}</h2>
          {episode.headline && <p className="mt-0.5 line-clamp-2 text-sm text-white/80">{episode.headline}</p>}
          {source && (
            <input
              type="range"
              min={0}
              max={time.of || 1}
              step={0.1}
              value={Math.min(time.at, time.of || 1)}
              aria-label={t.series.episode(episode.number)}
              onChange={(event) => {
                if (video.current) video.current.currentTime = Number(event.target.value);
              }}
              className="pointer-events-auto mt-3 h-1 w-full cursor-pointer accent-white"
            />
          )}
        </div>
      </div>
    </div>
  );
}
