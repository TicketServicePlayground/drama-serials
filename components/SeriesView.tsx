"use client";

import { useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { usePathname, useRouter } from "next/navigation";
import type { Episode, Serial } from "@/lib/catalog";
import type { AccountView } from "@/lib/billing-types";
import { getDictionary, withLocale, type Locale } from "@/lib/i18n";
import { trackPixel } from "@/lib/pixel";
import { trackEvent } from "@/lib/track";
import { CdnImage } from "./CdnImage";
import { EpisodeList } from "./EpisodeList";
import { FavoriteButton } from "./FavoriteButton";
import { CrownIcon } from "./icons";
import { LocalDate } from "./LocalDate";
import { PaywallModal } from "./PaywallModal";
import type { PaywallTarget, SeriesOption } from "./PaywallPanel";
import { PlayerModal } from "./PlayerModal";
import { Stats } from "./Stats";
import { useCollections } from "./useCollections";

const AuthModal = dynamic(() => import("./AuthModal").then((m) => m.AuthModal));

/** Time left as "5 h 12 min" / "12 min" (numbers and units read the same in every UI language). */
function timeLeft(untilMs: number, nowMs: number): string {
  const minutes = Math.max(1, Math.round((untilMs - nowMs) / 60000));
  const hours = Math.floor(minutes / 60);
  return hours > 0 ? `${hours} h ${minutes % 60} min` : `${minutes} min`;
}

/**
 * Series header and episodes. The first `freeEpisodes` play for anyone, signed in or not; the
 * rest need VIP, a one-series pass, or (not for VIP series) the episode bought on its own.
 * A locked episode asks a signed-out visitor to sign in first, then shows the paywall.
 */
export function SeriesView({ serial, locale, initialCollections, account, freeEpisodes, seriesOptions, autoPlay }: {
  serial: Serial;
  locale: Locale;
  initialCollections: { favorites: string[]; likes: string[] };
  /** null = signed out. */
  account: AccountView | null;
  freeEpisodes: number;
  /** Series that can be bought for a day (paywall choice). */
  seriesOptions: SeriesOption[];
  /** Episode to open right away (back from paying for it). */
  autoPlay: number | null;
}) {
  const t = getDictionary(locale);
  const router = useRouter();
  const pathname = usePathname();
  const { favorites, likes, toggleFavorite, toggleLike } = useCollections(initialCollections);
  const [paywall, setPaywall] = useState<PaywallTarget | null>(null);
  const [playing, setPlaying] = useState<Episode | null>(null);
  // Sign-in asked before the paywall: what to show once signed in.
  const [authFor, setAuthFor] = useState<PaywallTarget | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);

  const vip = account?.has_access ?? false;
  const passUntil = Date.parse(account?.series_passes.find((p) => p.slug === serial.slug)?.until ?? "") || 0;
  const pass = passUntil > now;
  const owned = new Set((account?.episodes ?? []).filter((e) => e.slug === serial.slug).map((e) => e.episode));
  const isFree = (episode: Episode) => episode.number <= freeEpisodes;
  // VIP series need a pass; a single bought episode does not open them.
  const isLocked = (episode: Episode) =>
    !isFree(episode) && !vip && !pass && (serial.vip || !owned.has(episode.number));
  const lastEpisode = serial.episodes[serial.episodes.length - 1]?.number;

  // No sign-up first: a signed-out visitor gives an email at paying (PaywallPanel).
  const openPaywall = useCallback((target: PaywallTarget) => setPaywall(target), []);

  const play = (episode: Episode) => {
    trackEvent("episode", `${serial.slug}/${episode.number}`);
    if (isLocked(episode)) openPaywall({ slug: serial.slug, episode: episode.number, vipOnly: serial.vip });
    else setPlaying(episode);
  };

  const needPayment = useCallback(
    (episode: Episode) => {
      setPlaying(null);
      openPaywall({ slug: serial.slug, episode: episode.number, vipOnly: serial.vip });
    },
    [serial.slug, serial.vip, openPaywall],
  );

  // Watched the last episode without VIP: offer VIP for every other series.
  const finished = useCallback(
    (episode: Episode) => {
      if (vip || episode.number !== lastEpisode) return;
      setPlaying(null);
      openPaywall({ slug: serial.slug, upsell: true });
    },
    [vip, lastEpisode, serial.slug, openPaywall],
  );

  useEffect(() => {
    trackPixel("ViewContent", { content_ids: [serial.slug], content_type: "product", content_name: serial.title });
  }, [serial.slug, serial.title]);

  useEffect(() => {
    if (autoPlay === null) return;
    const episode = serial.episodes.find((e) => e.number === autoPlay);
    if (episode) play(episode);
    // Drop ?play= so a reload does not reopen it.
    router.replace(withLocale(pathname, locale), { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <section className="mt-2 flex gap-4">
        <div className="relative shrink-0">
          <CdnImage
            image={serial.cover}
            priority
            sizes="144px"
            className="aspect-[2/3] w-28 rounded-xl object-cover sm:w-36"
          />
          <FavoriteButton
            locale={locale}
            active={favorites.has(serial.slug)}
            onToggle={() => toggleFavorite(serial.slug)}
            className="absolute top-1.5 left-1.5 size-8"
          />
        </div>
        <div className="flex min-w-0 flex-col items-start gap-2">
          <div className="flex flex-wrap gap-2 text-xs">
            <span className="rounded-md bg-gold-soft px-2 py-0.5 text-gold">{t.rank(serial.rank)}</span>
            <span className="rounded-md bg-surface-secondary px-2 py-0.5 text-muted">{t.genre[serial.genre] ?? serial.genre}</span>
            {serial.vip && (
              <span className="flex items-center gap-1 rounded-md bg-gold px-2 py-0.5 font-bold text-black">
                <CrownIcon className="size-3.5" />
                {t.tag.vip}
              </span>
            )}
          </div>
          <h1 className="text-xl leading-7 font-bold sm:text-2xl">{serial.title}</h1>
          <p className="text-sm leading-6 text-muted">{serial.synopsis}</p>
          {serial.vip && <p className="text-xs text-gold">{t.vipExtras.seriesNote}</p>}
          <Stats
            locale={locale}
            size="md"
            views={serial.views}
            likes={serial.likes}
            liked={likes.has(serial.slug)}
            onLike={() => toggleLike(serial.slug)}
          />
        </div>
      </section>

      {vip && account?.access_until ? (
        <p className="mt-5 flex items-center gap-2 rounded-xl bg-gold-soft px-3 py-2 text-sm text-gold">
          <CrownIcon className="size-4" />
          {t.paywall.activeUntil} <LocalDate iso={account.access_until} locale={locale} />
        </p>
      ) : pass ? (
        <p className="mt-5 flex items-center gap-2 rounded-xl bg-accent/15 px-3 py-2 text-sm font-medium text-accent">
          <CrownIcon className="size-4" />
          {t.series.passLeft(timeLeft(passUntil, now))}
        </p>
      ) : (
        <button
          type="button"
          onClick={() => openPaywall({ slug: serial.slug, vipOnly: serial.vip })}
          className="mt-5 flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-accent to-tag px-4 py-3 font-semibold text-accent-foreground shadow-lg outline-none transition-transform focus-visible:ring-2 focus-visible:ring-focus active:scale-[0.99]"
        >
          <CrownIcon className="size-5" />
          {t.unlockAll}
        </button>
      )}

      <h2 className="mt-8 mb-3 text-lg font-semibold">
        {t.series.episodesHeading} · {serial.episodes.length}
      </h2>
      <EpisodeList
        episodes={serial.episodes}
        locale={locale}
        likes={likes}
        isLocked={isLocked}
        isFree={(episode) => isFree(episode) && !vip && !pass}
        onLike={toggleLike}
        onPlay={play}
      />

      <PaywallModal
        locale={locale}
        target={paywall}
        series={seriesOptions}
        signedIn={account !== null}
        onSignIn={() => {
          trackEvent("auth_open", "pay");
          setAuthFor(paywall);
          setPaywall(null);
        }}
        onClose={() => setPaywall(null)}
      />
      <PlayerModal
        locale={locale}
        slug={serial.slug}
        episode={playing}
        onClose={() => setPlaying(null)}
        onPaymentRequired={needPayment}
        onEnded={finished}
      />
      {authFor && (
        <AuthModal
          locale={locale}
          isOpen
          reason="watch"
          initialMode="login"
          serial={null}
          onClose={() => setAuthFor(null)}
          onSuccess={() => {
            const target = authFor;
            setAuthFor(null);
            router.refresh();
            setPaywall(target);
          }}
        />
      )}
    </>
  );
}
