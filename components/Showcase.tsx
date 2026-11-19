"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import type { SerialCard } from "@/lib/catalog";
import { getDictionary, withLocale, type Locale } from "@/lib/i18n";
import { trackEvent } from "@/lib/track";
import type { AuthReason } from "./AuthModal";
import { CoverCard } from "./CoverCard";
import { BookmarkFilledIcon, BookmarkIcon, CloseIcon, CrownIcon, HomeIcon, PlayIcon, SearchIcon, UserIcon } from "./icons";
import { LanguageSwitcher } from "./LanguageSwitcher";
import { Logo } from "./Logo";
import { useCollections } from "./useCollections";

// The dialog (and its form/tabs code) is only downloaded once someone needs it.
const AuthModal = dynamic(() => import("./AuthModal").then((module) => module.AuthModal), { ssr: false });

const TAB_IDS = ["top", "rating", "new", "top10", "list"] as const;
type TabId = (typeof TAB_IDS)[number];

interface AuthState {
  open: boolean;
  reason: AuthReason;
  serial: SerialCard | null;
}

export function Showcase({ locale, serials, email, initialAuthSlug, initialCollections, footer }: {
  locale: Locale;
  serials: SerialCard[];
  email: string | null;
  /** Set when a signed-out visitor was bounced from a series page. */
  initialAuthSlug: string | null;
  initialCollections: { favorites: string[]; likes: string[] };
  /** Legal links, rendered on the server. */
  footer?: React.ReactNode;
}) {
  const t = getDictionary(locale);
  const router = useRouter();
  const { favorites, likes, toggleFavorite, toggleLike, addLike } = useCollections(initialCollections);
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<TabId>("top");
  const [auth, setAuth] = useState<AuthState>(() => {
    const serial = serials.find((item) => item.slug === initialAuthSlug) ?? null;
    const reason: AuthReason = serial ? "watch" : initialAuthSlug === "vip" ? "vip" : "generic";
    return { open: initialAuthSlug !== null, reason, serial };
  });

  // Stays true after the first open, so the dialog can animate out instead of unmounting.
  const [authMounted, setAuthMounted] = useState(initialAuthSlug !== null);
  useEffect(() => {
    // Bounced here from a series page or a link: the dialog is already open.
    if (initialAuthSlug !== null) trackEvent("auth_open", auth.reason);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const showAuth = (reason: AuthReason, serial: SerialCard | null) => {
    trackEvent("auth_open", reason);
    setAuthMounted(true);
    setAuth({ open: true, reason, serial });
  };

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    let list = needle ? serials.filter((serial) => serial.title.toLowerCase().includes(needle)) : serials;
    if (tab === "new") list = list.filter((serial) => serial.tag === "new");
    if (tab === "list") list = list.filter((serial) => favorites.has(serial.slug));
    if (tab === "rating") list = [...list].sort((a, b) => b.likes - a.likes);
    if (tab === "top10") list = [...list].sort((a, b) => b.views - a.views).slice(0, 10);
    return list;
  }, [serials, query, tab, favorites]);

  const open = (serial: SerialCard) => {
    trackEvent("cover", serial.slug);
    // The first episodes are free: the series page opens without signing in.
    router.push(withLocale(`/series/${serial.slug}`, locale));
  };

  const like = (serial: SerialCard) => {
    if (email) toggleLike(serial.slug);
    else showAuth("like", serial);
  };

  const openAuth = () => showAuth("generic", null);

  function onAuthSuccess() {
    const { reason, serial } = auth;
    setAuth((current) => ({ ...current, open: false }));
    if (reason === "watch" && serial) {
      router.push(withLocale(`/series/${serial.slug}`, locale));
      return;
    }
    if (reason === "vip") {
      router.push(withLocale("/vip", locale));
      return;
    }
    if (reason === "like" && serial) addLike(serial.slug);
    router.refresh();
  }

  const openVip = () => {
    if (email) router.push(withLocale("/vip", locale));
    else showAuth("vip", null);
  };

  const showList = () => {
    setTab("list");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-3 pb-24 sm:px-6 md:pb-10">
      <header className="sticky top-0 z-20 -mx-3 bg-background/95 px-3 pt-3 backdrop-blur sm:-mx-6 sm:px-6">
        <div className="flex items-center justify-between gap-3">
          <Logo href={withLocale("/", locale)} />
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={openVip}
              className="hidden h-8 cursor-pointer items-center gap-1.5 rounded-lg bg-surface px-3 text-sm font-medium text-gold outline-none hover:bg-surface-secondary focus-visible:ring-2 focus-visible:ring-focus sm:inline-flex"
            >
              <CrownIcon className="size-4" />{t.nav.vip}
            </button>
            <LanguageSwitcher locale={locale} />
            <button
              type="button"
              onClick={email ? () => router.push(withLocale("/profile", locale)) : openAuth}
              className={`hidden h-8 cursor-pointer items-center gap-1.5 rounded-lg px-3 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-focus sm:inline-flex ${
                email ? "bg-surface text-foreground hover:bg-surface-secondary" : "bg-accent text-accent-foreground hover:opacity-90"
              }`}
            >
              {email && <UserIcon className="size-4" />}
              {email ? t.nav.profile : t.signIn}
            </button>
          </div>
        </div>
        <label className="relative mt-2 flex items-center">
          <SearchIcon className="pointer-events-none absolute left-3 size-4 text-muted" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t.search.placeholder}
            aria-label={t.search.label}
            className="h-10 w-full rounded-xl bg-field pr-9 pl-9 text-sm text-field-foreground outline-none placeholder:text-field-placeholder focus-visible:ring-2 focus-visible:ring-focus [&::-webkit-search-cancel-button]:hidden"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="Clear"
              className="absolute right-2 flex size-6 cursor-pointer items-center justify-center rounded-full text-muted hover:text-foreground"
            >
              <CloseIcon className="size-4" />
            </button>
          )}
        </label>
        <nav aria-label="Sections" className="scrollbar-none -mx-3 mt-2 flex gap-6 overflow-x-auto px-3 py-2 sm:mx-0 sm:px-0">
          {TAB_IDS.map((id) => (
            <button
              key={id}
              type="button"
              aria-pressed={tab === id}
              onClick={() => setTab(id)}
              className={`flex cursor-pointer items-center gap-1 text-base whitespace-nowrap outline-none transition-colors focus-visible:underline ${
                tab === id ? "text-lg font-bold text-foreground" : "text-muted hover:text-foreground"
              }`}
            >
              {id === "list" && <BookmarkFilledIcon className="size-4 text-gold" />}
              {t.tabs[id]}
              {id === "list" && favorites.size > 0 && (
                <span className="rounded-full bg-surface-tertiary px-1.5 text-xs font-medium text-foreground">{favorites.size}</span>
              )}
            </button>
          ))}
        </nav>
      </header>

      <main className="mt-2 flex-1">
        {email && (
          <p className="mb-3 text-sm text-muted">
            {t.signedInAs} <span className="text-foreground">{email}</span>. {t.pickSeries}
          </p>
        )}
        {visible.length > 0 ? (
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 sm:gap-4 md:grid-cols-4 lg:grid-cols-5">
            {visible.map((serial, index) => (
              <CoverCard
                key={serial.slug}
                serial={serial}
                locale={locale}
                priority={index < 4}
                favorite={favorites.has(serial.slug)}
                liked={Boolean(email) && likes.has(serial.slug)}
                onOpen={() => open(serial)}
                onLike={() => like(serial)}
                onToggleFavorite={() => toggleFavorite(serial.slug)}
              />
            ))}
          </div>
        ) : (
          <p className="mx-auto max-w-xs py-16 text-center text-muted">
            {tab === "list" && !query ? t.emptyList : t.nothingFound}
          </p>
        )}
        {footer}
      </main>

      <nav
        aria-label="Navigation"
        className="fixed inset-x-0 bottom-0 z-20 flex justify-around border-t border-separator bg-background/95 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] backdrop-blur md:hidden"
      >
        <button
          type="button"
          onClick={() => setTab("top")}
          className={`flex cursor-pointer flex-col items-center gap-0.5 text-xs outline-none ${tab === "list" ? "text-muted" : "text-accent"}`}
        >
          <HomeIcon className="size-6" />{t.nav.home}
        </button>
        <span className="flex flex-col items-center gap-0.5 text-xs text-muted"><PlayIcon className="size-6" />{t.nav.forYou}</span>
        <button
          type="button"
          onClick={openVip}
          className="flex cursor-pointer flex-col items-center gap-0.5 text-xs font-medium text-gold outline-none"
        >
          <CrownIcon className="size-6" />{t.nav.vip}
        </button>
        <button
          type="button"
          onClick={showList}
          className={`relative flex cursor-pointer flex-col items-center gap-0.5 text-xs outline-none ${tab === "list" ? "text-accent" : "text-muted"}`}
        >
          <BookmarkIcon className="size-6" />{t.nav.list}
          {favorites.size > 0 && (
            <span className="absolute -top-1 right-1 flex size-4 items-center justify-center rounded-full bg-accent text-[10px] text-accent-foreground">
              {favorites.size}
            </span>
          )}
        </button>
        <button
          type="button"
          onClick={email ? () => router.push(withLocale("/profile", locale)) : openAuth}
          className="flex cursor-pointer flex-col items-center gap-0.5 text-xs text-muted outline-none focus-visible:text-foreground"
        >
          <UserIcon className="size-6" />{t.nav.profile}
        </button>
      </nav>

      {authMounted && <AuthModal
        locale={locale}
        isOpen={auth.open}
        reason={auth.reason}
        serial={auth.serial}
        onClose={() => setAuth((current) => ({ ...current, open: false }))}
        onSuccess={onAuthSuccess}
      />}
    </div>
  );
}
