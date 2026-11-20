"use client";

import { useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { usePathname, useRouter } from "next/navigation";
import type { Episode, Serial } from "@/lib/catalog";
import type { AccountView } from "@/lib/billing-types";
import { emailOfferSeen, gateGroup } from "@/lib/ab";
import { getDictionary, withLocale, type Locale } from "@/lib/i18n";
import { trackPixel, trackViewing } from "@/lib/pixel";
import { trackEvent } from "@/lib/track";
import { CdnImage } from "./CdnImage";
import { EpisodeList } from "./EpisodeList";
import { FavoriteButton } from "./FavoriteButton";
import { CrownIcon } from "./icons";
import { LocalDate } from "./LocalDate";
import { PaywallModal } from "./PaywallModal";
import type { PaywallTarget, SeriesOption } from "./PaywallPanel";
import { EmailGate } from "./EmailGate";
import { EpisodeFeed } from "./EpisodeFeed";
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
export function SeriesView({ serial, locale, initialCollections, account, freeEpisodes, emailBonus = 0, seriesOptions, autoPlay }: {
  serial: Serial;
  locale: Locale;
  initialCollections: { favorites: string[]; likes: string[] };
  /** null = signed out. */
  account: AccountView | null;
  freeEpisodes: number;
  /** The episodes after the free ones that open for an email left at the offer (A/B test). */
  emailBonus?: number;
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
  // Episode number the full-screen feed opened at; null = closed.
  const [feedAt, setFeedAt] = useState<number | null>(null);
  // Sign-in asked before the paywall: what to show once signed in.
  const [authFor, setAuthFor] = useState<PaywallTarget | null>(null);
  // Episode that asked for an email (EmailGate); null = closed.
  const [emailFor, setEmailFor] = useState<number | null>(null);
  // Signing in from the email gate (that email already has an account): the episode to play after.
  const [signInFor, setSignInFor] = useState<number | null>(null);
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
  // The next few after the free ones open for an email left at the offer.
  const isBonus = (episode: Episode) => episode.number > freeEpisodes && episode.number <= freeEpisodes + emailBonus;
  // VIP series need a pass; a single bought episode does not open them.
  const isLocked = (episode: Episode) =>
    !isFree(episode) && !(isBonus(episode) && account?.email_bonus) && !vip && !pass && (serial.vip || !owned.has(episode.number));
  // A/B test: the "email" group is offered, once, more free episodes for an email instead of the
  // plans; who already has an email (signed up) gets the plans as before.
  const offerEmail = (episode: Episode) =>
    isBonus(episode) && !account?.email && gateGroup() === "email" && !emailOfferSeen();
  const lastEpisode = serial.episodes[serial.episodes.length - 1]?.number;

  // No sign-up first: a signed-out visitor gives an email at paying (PaywallPanel).
  const openPaywall = useCallback((target: PaywallTarget) => setPaywall(target), []);

  const play = (episode: Episode) => {
    if (isLocked(episode) && offerEmail(episode)) {
      // The feed opens behind the offer and plays on once the email is in.
      setFeedAt(episode.number);
      setEmailFor(episode.number);
    } else if (isLocked(episode)) {
      trackEvent("episode", `${serial.slug}/${episode.number}`);
      openPaywall({ slug: serial.slug, episode: episode.number, vipOnly: serial.vip });
    } else setFeedAt(episode.number);
  };

  // Swiped on to a locked episode: the email offer (once, "email" group) or the paywall.
  const needPayment = (episode: Episode) => {
    if (offerEmail(episode)) setEmailFor(episode.number);
    else openPaywall({ slug: serial.slug, episode: episode.number, vipOnly: serial.vip });
  };

  // Watched the last episode without VIP: offer VIP for every other series.
  const finished = useCallback(
    (episode: Episode) => {
      if (vip || episode.number !== lastEpisode) return;
      setFeedAt(null);
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
        onLike={toggleLike}
        onPlay={play}
      />

      <PaywallModal
        locale={locale}
        target={paywall}
        series={seriesOptions}
        signedIn={account !== null}
        hasEmail={Boolean(account?.email)}
        onSignIn={() => {
          trackEvent("auth_open", "pay");
          setAuthFor(paywall);
          setPaywall(null);
        }}
        onClose={() => setPaywall(null)}
      />
      <EpisodeFeed
        locale={locale}
        slug={serial.slug}
        seriesTitle={serial.title}
        episodes={serial.episodes}
        start={feedAt}
        isLocked={isLocked}
        onClose={() => setFeedAt(null)}
        onLocked={needPayment}
        onWatch={(episode) => {
          trackEvent("episode", `${serial.slug}/${episode.number}`);
          trackViewing(serial.slug, episode.number);
        }}
        onFinished={finished}
      />
      <EmailGate
        locale={locale}
        slug={serial.slug}
        episode={emailFor}
        bonus={emailBonus}
        onDone={() => {
          // Signed in now: the account (with its email) comes back and the feed plays on.
          setEmailFor(null);
          router.refresh();
        }}
        onSignIn={() => {
          setSignInFor(emailFor);
          setEmailFor(null);
        }}
        onPaywall={() => {
          const episode = emailFor;
          setEmailFor(null);
          openPaywall({ slug: serial.slug, episode: episode ?? undefined, vipOnly: serial.vip });
        }}
        onClose={() => setEmailFor(null)}
      />
      {signInFor !== null && (
        <AuthModal
          locale={locale}
          isOpen
          reason="watch"
          initialMode="login"
          serial={null}
          onClose={() => setSignInFor(null)}
          onSuccess={() => {
            setSignInFor(null);
            router.refresh();
          }}
        />
      )}
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
