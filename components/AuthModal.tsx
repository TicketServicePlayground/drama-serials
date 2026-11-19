"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { Button, FieldError, Form, Input, Label, Modal, Tabs, TextField } from "@heroui/react";
import type { SerialCard } from "@/lib/catalog";
import { getDictionary, withLocale, type Locale } from "@/lib/i18n";
import { trackPixel } from "@/lib/pixel";
import { CdnImage } from "./CdnImage";
import { HeartIcon, LockIcon } from "./icons";

type Mode = "register" | "login";
export type AuthReason = "watch" | "like" | "vip" | "generic";

const ENDPOINT: Record<Mode, string> = { register: "/api/auth/register", login: "/api/auth/login" };

/** Sign-up / sign-in dialog. `serial` is the cover the visitor interacted with, if any. */
export function AuthModal({ locale, isOpen, reason, serial, initialMode = "register", onClose, onSuccess }: {
  locale: Locale;
  isOpen: boolean;
  /** Open on sign-in instead of sign-up (e.g. the paywall found an account for the email). */
  initialMode?: Mode;
  reason: AuthReason;
  serial: SerialCard | null;
  onClose: () => void;
  onSuccess: (email: string) => void;
}) {
  const t = getDictionary(locale);
  const [mode, setMode] = useState<Mode>(initialMode);
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);
  const [accepted, setAccepted] = useState(false);
  // "Forgot password?": an email form instead of the tabs; `sent` once the link went out.
  const [forgot, setForgot] = useState<"off" | "form" | "sent">("off");

  async function onForgot(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setError(undefined);
    setPending(true);
    try {
      const response = await fetch("/api/auth/forgot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: form.get("email"), locale }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) setError(t.auth.errors[data.error] ?? t.auth.errors.generic);
      else setForgot("sent");
    } catch {
      setError(t.auth.errors.network);
    } finally {
      setPending(false);
    }
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    if (mode === "register" && !accepted) {
      setError(t.consent.signupRequired);
      return;
    }
    setError(undefined);
    setPending(true);
    try {
      const response = await fetch(ENDPOINT[mode], {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: form.get("email"),
          password: form.get("password"),
          accept_terms: mode === "register" ? accepted : undefined,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(t.auth.errors[data.error] ?? t.auth.errors.generic);
        setPending(false);
        return;
      }
      setPending(false);
      if (mode === "register") trackPixel("CompleteRegistration");
      onSuccess(data.email);
    } catch {
      setError(t.auth.errors.network);
      setPending(false);
    }
  }

  const heading = {
    like: t.auth.likeHeading,
    watch: t.auth.watchHeading,
    vip: t.auth.vipHeading,
    generic: t.auth.genericHeading,
  }[reason];

  return (
    <Modal isOpen={isOpen} onOpenChange={(open) => { if (!open && !pending) onClose(); }}>
      <Modal.Backdrop isDismissable={!pending} isKeyboardDismissDisabled={pending}>
        <Modal.Container size="sm" placement="center">
          <Modal.Dialog>
            <Modal.CloseTrigger />
            <Modal.Header>
              <div className="flex items-center gap-3">
                {serial ? (
                  <span className="relative shrink-0">
                    <CdnImage image={serial.cover} sizes="54px" priority className="h-20 w-[3.35rem] rounded-md object-cover" />
                    {reason === "like" && (
                      <span className="absolute -right-1.5 -bottom-1.5 flex size-6 items-center justify-center rounded-full bg-accent text-accent-foreground">
                        <HeartIcon filled className="size-3.5" />
                      </span>
                    )}
                  </span>
                ) : (
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent">
                    <LockIcon className="size-5" />
                  </span>
                )}
                <div className="min-w-0">
                  <Modal.Heading>{heading}</Modal.Heading>
                  {serial && (
                    <p className="mt-1 truncate text-sm text-muted">
                      {serial.title} · {t.auth.episodes(serial.episodeCount)}
                    </p>
                  )}
                </div>
              </div>
            </Modal.Header>
            <Modal.Body>
              {forgot !== "off" ? (
                <div className="flex flex-col gap-4">
                  <div>
                    <p className="font-semibold">{t.auth.forgotHeading}</p>
                    <p className="mt-1 text-sm text-muted">{forgot === "sent" ? t.auth.forgotSent : t.auth.forgotLead}</p>
                  </div>
                  {forgot === "form" && (
                    <Form onSubmit={onForgot} className="flex flex-col gap-4">
                      <TextField name="email" type="email" isRequired fullWidth isDisabled={pending}>
                        <Label>{t.auth.email}</Label>
                        <Input placeholder="you@example.com" autoComplete="email" autoFocus />
                        <FieldError>{t.auth.emailInvalid}</FieldError>
                      </TextField>
                      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
                      <Button type="submit" variant="primary" fullWidth isPending={pending}>
                        {t.auth.forgotSubmit}
                      </Button>
                    </Form>
                  )}
                  <button
                    type="button"
                    onClick={() => { setForgot("off"); setMode("login"); setError(undefined); }}
                    className="cursor-pointer text-sm text-muted underline underline-offset-2 hover:text-foreground"
                  >
                    {t.auth.backToLogin}
                  </button>
                </div>
              ) : (<>
              <Tabs
                selectedKey={mode}
                onSelectionChange={(key) => { setMode(key as Mode); setError(undefined); }}
                className="mb-4 w-full"
              >
                <Tabs.ListContainer>
                  <Tabs.List aria-label={t.auth.tabsLabel} className="w-full *:flex-1">
                    <Tabs.Tab id="register">{t.auth.registerTab}<Tabs.Indicator /></Tabs.Tab>
                    <Tabs.Tab id="login">{t.auth.loginTab}<Tabs.Indicator /></Tabs.Tab>
                  </Tabs.List>
                </Tabs.ListContainer>
              </Tabs>
              <Form onSubmit={onSubmit} className="flex flex-col gap-4">
                <TextField name="email" type="email" isRequired fullWidth isDisabled={pending}>
                  <Label>{t.auth.email}</Label>
                  <Input placeholder="you@example.com" autoComplete="email" autoFocus />
                  <FieldError>{t.auth.emailInvalid}</FieldError>
                </TextField>
                <TextField name="password" type="password" isRequired minLength={6} fullWidth isDisabled={pending}>
                  <Label>{t.auth.password}</Label>
                  <Input
                    placeholder={mode === "register" ? t.auth.passwordNew : t.auth.passwordCurrent}
                    autoComplete={mode === "register" ? "new-password" : "current-password"}
                  />
                  <FieldError>{t.auth.passwordShort}</FieldError>
                </TextField>
                {mode === "register" && (
                  <label className="flex cursor-pointer items-start gap-2.5 text-xs leading-5 text-muted">
                    <input
                      type="checkbox"
                      checked={accepted}
                      onChange={(event) => {
                        setAccepted(event.target.checked);
                        if (event.target.checked) setError(undefined);
                      }}
                      disabled={pending}
                      className="mt-0.5 size-4 shrink-0 cursor-pointer accent-accent"
                    />
                    <span>
                      {t.consent.signupLead}{" "}
                      <Link href={withLocale("/legal/terms", locale)} target="_blank" className="text-foreground underline underline-offset-2">
                        {t.consent.terms}
                      </Link>{" "}
                      {t.consent.and}{" "}
                      <Link href={withLocale("/legal/privacy", locale)} target="_blank" className="text-foreground underline underline-offset-2">
                        {t.consent.privacy}
                      </Link>
                      .
                    </span>
                  </label>
                )}
                {error && <p role="alert" className="text-sm text-danger">{error}</p>}
                <Button type="submit" variant="primary" fullWidth isPending={pending}>
                  {mode === "register" ? t.auth.registerSubmit : t.auth.loginSubmit}
                </Button>
                {mode === "register" && <p className="text-center text-xs text-muted">{t.auth.noConfirm}</p>}
                {mode === "login" && (
                  <button
                    type="button"
                    onClick={() => { setForgot("form"); setError(undefined); }}
                    className="cursor-pointer text-center text-sm text-muted underline underline-offset-2 hover:text-foreground"
                  >
                    {t.auth.forgot}
                  </button>
                )}
              </Form>
              </>)}
            </Modal.Body>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}
