"use client";

import { useEffect, useState } from "react";
import { Button, Modal } from "@heroui/react";
import { markEmailOfferSeen } from "@/lib/ab";
import { getDictionary, type Locale } from "@/lib/i18n";
import { trackPixel } from "@/lib/pixel";
import { trackEvent } from "@/lib/track";

/**
 * A/B test, "email" group (lib/ab.ts): at the first locked episode, once, instead of the plans,
 * an offer of a few more free episodes for an email. Not required: the plans are a tap away, and
 * closing it leaves the usual lock. The address is confirmed with a 6-digit code emailed to it;
 * the right code creates the account (its password goes to that address too), signs the visitor
 * in and opens those episodes, so the feed plays on; the plans come at the episode after them.
 */
export function EmailGate({ locale, slug, episode, bonus, onDone, onSignIn, onPaywall, onClose }: {
  locale: Locale;
  slug: string;
  /** Episode that asked for the email; null = closed. */
  episode: number | null;
  /** How many episodes the email opens. */
  bonus: number;
  onDone: () => void;
  /** The email already has an account: sign in instead. */
  onSignIn: () => void;
  /** "Open all episodes": the plans instead. */
  onPaywall: () => void;
  onClose: () => void;
}) {
  const t = getDictionary(locale).emailGate;
  const [email, setEmail] = useState("");
  // Step two: the code was sent; the signed challenge comes back with it.
  const [challenge, setChallenge] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [taken, setTaken] = useState(false);

  useEffect(() => {
    if (episode === null) return;
    setError(null);
    setTaken(false);
    markEmailOfferSeen();
    trackEvent("email_gate", `${slug}/${episode}`);
  }, [episode, slug]);

  const MESSAGES: Record<string, string> = {
    email_taken: t.taken,
    invalid_email: t.invalid,
    bad_code: t.badCode,
    code_expired: t.expired,
    too_many_attempts: t.tooMany,
    too_soon: t.tooSoon,
    mail_failed: t.mailFailed,
  };

  async function post(url: string, payload: object): Promise<{ ok: boolean; data: Record<string, string> }> {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return { ok: response.ok, data: await response.json().catch(() => ({})) };
  }

  async function run(step: () => Promise<void>) {
    setPending(true);
    setError(null);
    setTaken(false);
    try {
      await step();
    } catch {
      setError(t.error);
    } finally {
      setPending(false);
    }
  }

  const sendCode = () =>
    run(async () => {
      const { ok, data } = await post("/api/auth/email-code", { email: email.trim(), locale });
      if (ok) {
        setChallenge(data.challenge);
        setCode("");
        return;
      }
      if (data.error === "email_taken") setTaken(true);
      setError(MESSAGES[data.error] ?? t.error);
    });

  const confirm = () =>
    run(async () => {
      const { ok, data } = await post("/api/auth/quick", {
        email: email.trim(),
        locale,
        source: "email_gate",
        code: code.trim(),
        challenge,
      });
      if (ok) {
        trackPixel("CompleteRegistration", { content_name: "email_gate" });
        onDone();
        return;
      }
      if (data.error === "email_taken") setTaken(true);
      setError(MESSAGES[data.error] ?? t.error);
    });

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (challenge === null) {
      if (!/^\S+@\S+\.\S+$/.test(email.trim())) {
        setError(t.invalid);
        return;
      }
      sendCode();
    } else if (/^\d{6}$/.test(code.trim())) confirm();
    else setError(t.badCode);
  }

  const field = `rounded-xl border bg-surface-secondary px-3 py-2.5 text-foreground outline-none focus-visible:ring-2 ${
    error ? "border-danger ring-2 ring-danger" : "border-border focus-visible:ring-focus"
  }`;

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
                {challenge === null ? (
                  <>
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
                      className={field}
                    />
                  </>
                ) : (
                  <>
                    <p className="text-sm text-muted">{t.codeSent(email.trim())}</p>
                    <input
                      type="text"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      autoFocus
                      maxLength={6}
                      aria-label={t.code}
                      value={code}
                      onChange={(event) => { setCode(event.target.value.replace(/\D/g, "")); setError(null); }}
                      placeholder="000000"
                      disabled={pending}
                      aria-invalid={error !== null}
                      className={`${field} text-center font-mono text-2xl tracking-[0.4em]`}
                    />
                  </>
                )}
                <Button
                  type="submit"
                  variant="primary"
                  size="lg"
                  fullWidth
                  isPending={pending}
                  className="bg-gradient-to-r from-accent to-tag text-base font-bold text-accent-foreground shadow-lg"
                >
                  {challenge === null ? t.sendCode : t.confirm}
                </Button>
                {challenge !== null && (
                  <div className="flex justify-between text-sm">
                    <button type="button" disabled={pending} onClick={sendCode} className="cursor-pointer text-accent underline-offset-2 hover:underline">
                      {t.resend}
                    </button>
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => { setChallenge(null); setCode(""); setError(null); }}
                      className="cursor-pointer text-muted underline-offset-2 hover:underline"
                    >
                      {t.otherEmail}
                    </button>
                  </div>
                )}
                <Button type="button" variant="secondary" fullWidth isDisabled={pending} onPress={onPaywall}>
                  {t.allEpisodes}
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
