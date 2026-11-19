"use client";

import { useEffect, useState } from "react";
import { Modal, Spinner } from "@heroui/react";
import type { Episode } from "@/lib/catalog";
import { getDictionary, type Locale } from "@/lib/i18n";
import { CrownIcon } from "./icons";

type State = { kind: "loading" } | { kind: "ready"; url: string; points: number } | { kind: "notReady" } | { kind: "error" };

/** Plays an episode the viewer has access to, from a short-lived signed URL. */
export function PlayerModal({ locale, slug, episode, onClose, onPaymentRequired, onEnded }: {
  locale: Locale;
  slug: string;
  /** null = closed. */
  episode: Episode | null;
  onClose: () => void;
  /** Access ended meanwhile (pass expired): show the paywall instead. */
  onPaymentRequired: (episode: Episode) => void;
  /** The episode played to the end. */
  onEnded?: (episode: Episode) => void;
}) {
  const t = getDictionary(locale);
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    if (!episode) return;
    let cancelled = false;
    setState({ kind: "loading" });
    fetch(`/api/play/${slug}/${episode.number}?lang=${locale}`, { cache: "no-store" })
      .then(async (response) => {
        if (cancelled) return;
        if (response.status === 402) return onPaymentRequired(episode);
        if (response.status === 404) return setState({ kind: "notReady" });
        const data = await response.json();
        setState(response.ok && data.url ? { kind: "ready", url: data.url, points: data.points_awarded ?? 0 } : { kind: "error" });
      })
      .catch(() => !cancelled && setState({ kind: "error" }));
    return () => {
      cancelled = true;
    };
  }, [episode, slug, locale, onPaymentRequired]);

  return (
    <Modal isOpen={episode !== null} onOpenChange={(open) => { if (!open) onClose(); }}>
      <Modal.Backdrop variant="blur">
        <Modal.Container size="lg" placement="center">
          <Modal.Dialog aria-label={episode ? `${t.series.episode(episode.number)} · ${episode.title}` : ""} className="overflow-hidden p-0">
            <Modal.CloseTrigger aria-label={t.player.close} className="z-10" />
            {episode && (
              <div>
                {state.kind === "ready" ? (
                  // Short-drama episodes are usually vertical: the player takes the video's own shape.
                  <video
                    key={state.url}
                    src={state.url}
                    poster={episode.image?.src}
                    controls
                    autoPlay
                    playsInline
                    controlsList="nodownload"
                    onEnded={() => onEnded?.(episode)}
                    className="mx-auto block max-h-[78dvh] w-full bg-black"
                  />
                ) : (
                  <div className="relative flex aspect-video w-full items-center justify-center bg-black">
                    {episode.image && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={episode.image.src} alt="" className="absolute inset-0 size-full object-cover opacity-40" />
                    )}
                    {state.kind === "loading" ? (
                      <Spinner size="lg" />
                    ) : (
                      <p className="relative max-w-xs px-6 text-center text-sm font-medium text-white">
                        {state.kind === "notReady" ? t.player.notReady : t.player.error}
                      </p>
                    )}
                  </div>
                )}
                <div className="p-4">
                  {state.kind === "ready" && state.points > 0 && (
                    <p className="mb-2 flex items-center gap-1.5 rounded-lg bg-gold-soft px-2.5 py-1.5 text-sm font-semibold text-gold">
                      <CrownIcon className="size-4" />
                      {t.vipExtras.toast(state.points)}
                    </p>
                  )}
                  <p className="text-xs text-muted">{t.series.episode(episode.number)}</p>
                  <h2 className="text-base font-semibold">{episode.title}</h2>
                </div>
              </div>
            )}
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}
