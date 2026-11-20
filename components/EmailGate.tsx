"use client";

import { useEffect, useState } from "react";
import { Button, Modal } from "@heroui/react";
import { getDictionary, type Locale } from "@/lib/i18n";
import { trackPixel } from "@/lib/pixel";
import { trackEvent } from "@/lib/track";

/**
 * More free episodes for an email: shown instead of the paywall when a signed-out visitor (or a
 * guest without an email) reaches the episodes right after the free ones. The email creates the
 * account at once (the password goes to that address) and signs the visitor in, so the feed plays
 * on without any other step.
 */
export function EmailGate({ locale, slug, episode, bonus, onDone, onSignIn, onClose }: {
  locale: Locale;
  slug: string;
  /** Episode that asked for the email; null = closed. */
  episode: number | null;
  /** How many episodes the email opens. */
  bonus: number;
  onDone: () => void;
  /** The email already has an account: sign in instead. */
  onSignIn: () => void;
  onClose: () => void;
}) {
  const t = getDictionary(locale).emailGate;
  const [email, setEmail] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [taken, setTaken] = useState(false);

  useEffect(() => {
    if (episode === null) return;
    setError(null);
    setTaken(false);
    trackEvent("email_gate", `${slug}/${episode}`);
  }, [episode, slug]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) {
      setError(t.invalid);
      return;
    }
    setPending(true);
    setError(null);
    setTaken(false);
    try {
      const response = await fetch("/api/auth/quick", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), locale }),
      });
      const data = await response.json().catch(() => ({}));
      if (response.ok) {
        trackPixel("CompleteRegistration", { content_name: "email_gate" });
        onDone();
        return;
      }
      if (data.error === "email_taken") setTaken(true);
      setError(data.error === "email_taken" ? t.taken : data.error === "invalid_email" ? t.invalid : t.error);
    } catch {
      setError(t.error);
    } finally {
      setPending(false);
    }
  }

  return (
    <Modal isOpen={episode !== null} onOpenChange={(open) => { if (!open) onClose(); }}>
      <Modal.Backdrop>
        <Modal.Container size="sm" placement="center">
          <Modal.Dialog aria-label={t.title(bonus)}>
            <Modal.CloseTrigger aria-label={t.close} />
            <Modal.Header>
              <Modal.Heading>{t.title(bonus)}</Modal.Heading>
            </Modal.Header>
            <Modal.Body>
              <form onSubmit={submit} className="flex flex-col gap-3">
                <p className="text-sm text-muted">{t.text}</p>
                <input
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  autoFocus
                  required
                  value={email}
                  onChange={(event) => { setEmail(event.target.value); setError(null); setTaken(false); }}
                  placeholder="you@example.com"
                  disabled={pending}
                  aria-invalid={error !== null}
                  className={`rounded-xl border bg-surface-secondary px-3 py-2.5 text-foreground outline-none focus-visible:ring-2 ${
                    error ? "border-danger ring-2 ring-danger" : "border-border focus-visible:ring-focus"
                  }`}
                />
                <Button
                  type="submit"
                  variant="primary"
                  size="lg"
                  fullWidth
                  isPending={pending}
                  className="bg-gradient-to-r from-accent to-tag text-base font-bold text-accent-foreground shadow-lg"
                >
                  {t.button}
                </Button>
                {error && (
                  <p role="alert" className="text-sm text-danger">
                    {error}{" "}
                    {taken && (
                      <button type="button" onClick={onSignIn} className="cursor-pointer font-semibold underline">
                        {t.signIn}
                      </button>
                    )}
                  </p>
                )}
              </form>
            </Modal.Body>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}
