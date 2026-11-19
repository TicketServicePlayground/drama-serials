"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CONSENT_EVENT, FAVORITES_COOKIE, LIKES_COOKIE, writeListCookie } from "@/lib/collections";

/** Favourites and likes, mirrored into cookies on every change (when the visitor allowed it). */
export function useCollections(initial: { favorites: string[]; likes: string[] }) {
  const [favorites, setFavorites] = useState(() => new Set(initial.favorites));
  const [likes, setLikes] = useState(() => new Set(initial.likes));
  const latest = useRef({ favorites, likes });
  latest.current = { favorites, likes };

  // Accepted in the banner after something was already saved this visit: persist it now.
  useEffect(() => {
    const onConsent = (event: Event) => {
      if ((event as CustomEvent).detail !== "all") return;
      writeListCookie(FAVORITES_COOKIE, [...latest.current.favorites]);
      writeListCookie(LIKES_COOKIE, [...latest.current.likes]);
    };
    window.addEventListener(CONSENT_EVENT, onConsent);
    return () => window.removeEventListener(CONSENT_EVENT, onConsent);
  }, []);

  const toggle = (set: Set<string>, item: string, cookie: string) => {
    const next = new Set(set);
    if (next.has(item)) next.delete(item);
    else next.add(item);
    writeListCookie(cookie, [...next]);
    return next;
  };

  const toggleFavorite = useCallback((slug: string) => {
    setFavorites((current) => toggle(current, slug, FAVORITES_COOKIE));
  }, []);

  const toggleLike = useCallback((id: string) => {
    setLikes((current) => toggle(current, id, LIKES_COOKIE));
  }, []);

  /** Adds without toggling: used right after sign-up from a like tap. */
  const addLike = useCallback((id: string) => {
    setLikes((current) => (current.has(id) ? current : toggle(current, id, LIKES_COOKIE)));
  }, []);

  return { favorites, likes, toggleFavorite, toggleLike, addLike };
}
