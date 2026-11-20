"use client";

import { Modal } from "@heroui/react";
import { getDictionary, type Locale } from "@/lib/i18n";
import { PaywallPanel, type PaywallTarget, type SeriesOption } from "./PaywallPanel";

export function PaywallModal({ locale, target, series, signedIn = true, hasEmail = signedIn, onSignIn, onClose }: {
  locale: Locale;
  /** null = closed. */
  target: PaywallTarget | null;
  series: SeriesOption[];
  signedIn?: boolean;
  hasEmail?: boolean;
  onSignIn?: () => void;
  onClose: () => void;
}) {
  const t = getDictionary(locale);
  return (
    <Modal isOpen={target !== null} onOpenChange={(open) => { if (!open) onClose(); }}>
      <Modal.Backdrop>
        <Modal.Container size="md" placement="center" scroll="inside">
          <Modal.Dialog aria-label={t.paywall.title}>
            <Modal.CloseTrigger aria-label={t.paywall.close} />
            <Modal.Header>
              <Modal.Heading>{t.paywall.title}</Modal.Heading>
            </Modal.Header>
            <Modal.Body>
              {target && <PaywallPanel locale={locale} target={target} series={series} signedIn={signedIn} hasEmail={hasEmail} onSignIn={onSignIn} />}
            </Modal.Body>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}
