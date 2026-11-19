"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button, FieldError, Form, Input, Label, TextField } from "@heroui/react";
import { getDictionary, withLocale, type Locale } from "@/lib/i18n";

export function ResetPasswordForm({ locale, token }: { locale: Locale; token: string }) {
  const t = getDictionary(locale);
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | undefined>(token ? undefined : t.auth.resetInvalid);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setError(undefined);
    setPending(true);
    try {
      const response = await fetch("/api/auth/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password: form.get("password") }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(t.auth.errors[data.error] ?? t.auth.errors.generic);
        setPending(false);
        return;
      }
      router.replace(withLocale("/", locale));
      router.refresh();
    } catch {
      setError(t.auth.errors.network);
      setPending(false);
    }
  }

  return (
    <Form onSubmit={onSubmit} className="mt-4 flex flex-col gap-4">
      <TextField name="password" type="password" isRequired minLength={6} fullWidth isDisabled={pending || !token}>
        <Label>{t.auth.newPassword}</Label>
        <Input placeholder={t.auth.passwordNew} autoComplete="new-password" autoFocus />
        <FieldError>{t.auth.passwordShort}</FieldError>
      </TextField>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <Button type="submit" variant="primary" fullWidth isPending={pending} isDisabled={!token}>
        {t.auth.resetSubmit}
      </Button>
    </Form>
  );
}
