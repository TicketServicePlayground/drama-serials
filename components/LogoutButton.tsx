"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@heroui/react";
import { getDictionary, withLocale, type Locale } from "@/lib/i18n";

export function LogoutButton({ locale }: { locale: Locale }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  return (
    <Button
      variant="tertiary"
      size="sm"
      isPending={pending}
      onPress={async () => {
        setPending(true);
        await fetch("/api/auth/logout", { method: "POST" });
        router.push(withLocale("/", locale));
        router.refresh();
      }}
    >
      {getDictionary(locale).logout}
    </Button>
  );
}
