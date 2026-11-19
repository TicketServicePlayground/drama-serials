import type { LegalSet } from "./legal";

export const LEGAL_EN: LegalSet = {
  updated: "Last updated: 14 November 2026",
  terms: {
    title: "Terms of Service",
    short: "Terms",
    intro:
      "These Terms govern your use of AN Serials at {site}, a streaming service for short drama series operated by {name}, {address} (\"we\", \"us\"). By creating an account or making a purchase you agree to these Terms, the Privacy Policy and the Refund Policy.",
    sections: [
      {
        heading: "1. Who can use the service",
        paragraphs: [
          "You must be at least 18 years old, or have the consent of a parent or guardian, to create an account and make purchases.",
          "You are responsible for keeping your password secret and for everything done through your account. Tell us at {email} if you think your account has been used without your permission.",
        ],
      },
      {
        heading: "2. Account",
        paragraphs: [
          "You sign up with an email address and a password; we do not verify the address. Use an address you control: it is how we identify your purchases and answer your requests.",
          "One account is for one person. You may not sell, share or transfer access to it.",
        ],
      },
      {
        heading: "3. What you can buy",
        paragraphs: [
          "Single episode: permanent access to that one episode for as long as the service operates and the episode is in the catalogue.",
          "7-day, 30-day and 1-year passes: access to every episode of every series for 7 days, 30 days or 365 days from the moment the payment is confirmed. A pass bought while another is active extends it. Passes do not renew automatically; nothing is charged after the period ends.",
          "One series for a day: every episode of the chosen series for 24 hours from the moment the payment is confirmed. The first episodes of every series are free; the series page shows which.",
          "VIP passes are sold at a launch price until the date shown next to it; after that date the regular price, shown crossed out, applies.",
          "VIP series are available only with an active VIP pass; their episodes are not sold one by one. VIP points: a VIP member gets 50 points for each day they watch at least one episode, and 1,000 points can be exchanged in the profile for 1 day of VIP. Points have no cash value, cannot be transferred or refunded, and the rules may change or end; VIP days already received are kept.",
          "Prices are shown in Indonesian rupiah (IDR) and include all taxes we are required to charge. The price you pay is the one shown on the payment page at the moment you open it.",
        ],
      },
      {
        heading: "4. One-time offer",
        paragraphs: [
          "The first time you see the purchase screen, a limited introductory offer starts for your account: half the regular price for the time shown on the countdown (3 hours). When it ends, regular prices apply. The offer is given once per account and cannot be restarted.",
        ],
      },
      {
        heading: "5. Payment",
        paragraphs: [
          "Payments are processed by licensed payment providers: QRIS through Xendit, cards through DOKU and SBP (Russia's Faster Payments System) through IXPAY. Their pages may show the merchant name of our operating company. We do not receive or store your card number or bank credentials.",
          "Access opens as soon as the provider confirms the payment, usually within seconds. If a payment is confirmed but access does not open, contact us and we will fix it or refund you.",
        ],
      },
      {
        heading: "6. Use of content",
        paragraphs: [
          "All series, episodes, images and texts are protected by copyright and are licensed to you for personal, non-commercial viewing only. You may not copy, download, record, re-upload, broadcast or share them, or try to bypass access controls.",
          "The catalogue may change: series and episodes can be added, edited or removed.",
        ],
      },
      {
        heading: "7. Suspension",
        paragraphs: [
          "We may suspend or close an account that breaks these Terms, is used for fraud, or shares access. If we close an account without a breach on your side, we refund the unused part of an active pass.",
        ],
      },
      {
        heading: "8. Liability",
        paragraphs: [
          "The service is provided as available. We work to keep it running but cannot promise it will be uninterrupted. To the extent permitted by law, our liability for any claim related to the service is limited to the amount you paid us in the 30 days before the claim. Nothing in these Terms limits rights you have as a consumer under Indonesian law.",
        ],
      },
      {
        heading: "9. Changes and law",
        paragraphs: [
          "We may update these Terms; the date at the top shows the current version. Changes apply to purchases made after they are published. Material changes will be shown on the site.",
          "These Terms are governed by the laws of the Republic of Indonesia. Disputes are first resolved by negotiation; if that fails, by the competent court in Jakarta, without prejudice to your consumer rights.",
          "Questions: {email}.",
        ],
      },
    ],
  },
  privacy: {
    title: "Privacy Policy",
    short: "Privacy",
    intro:
      "This Policy explains what personal data AN Serials collects, why, and what your rights are. The controller of your data is {name}, {address}. We process personal data in line with Indonesian Law No. 27 of 2022 on Personal Data Protection.",
    sections: [
      {
        heading: "1. What we collect",
        paragraphs: [
          "Account: your email address and a one-way hash of your password (we never see or store the password itself), the date you accepted these documents.",
          "Purchases: what you bought, the amount, the payment method (QRIS or card), status and time, and the reference numbers from the payment provider. Card numbers and bank credentials are entered on the provider's page and never reach us.",
          "Use of the service: the language you chose, likes and your list of saved series (stored in your browser), and technical data our servers record when you visit (IP address, browser type, time of request). Our own visit counter keeps no cookies and stores a code that changes daily instead of your IP address.",
        ],
      },
      {
        heading: "2. Why we use it",
        paragraphs: [
          "To create and secure your account and let you sign in (performance of the contract).",
          "To take payments, open access and keep purchase records (performance of the contract and legal accounting obligations).",
          "To prevent fraud and abuse, and to keep the service working (legitimate interest).",
          "We do not sell your data. Through the Meta Pixel, Meta receives events about your visit to measure our ads (see the Cookie Policy).",
        ],
      },
      {
        heading: "3. Who receives it",
        paragraphs: [
          "Payment providers: Xendit (QRIS), DOKU (cards) and IXPAY (SBP) receive the payment amount, your email and the order reference.",
          "Infrastructure: our hosting provider (servers) and Cloudflare (content delivery) process data as needed to deliver the site and videos.",
          "Meta Platforms (Facebook, Instagram), through the Meta Pixel: the events described in the Cookie Policy, to measure our ads.",
          "Our team receives internal notifications about new sign-ups and payments (email, product, amount) through a private Telegram channel, used only to support customers and check payments.",
          "Authorities, when required by law.",
        ],
      },
      {
        heading: "4. How long we keep it",
        paragraphs: [
          "Account data: while your account exists. After you ask us to delete it, we erase it within 30 days.",
          "Purchase records: as long as Indonesian tax and accounting law requires (up to 10 years), even after the account is deleted.",
          "Server logs: up to 90 days.",
        ],
      },
      {
        heading: "5. Your rights",
        paragraphs: [
          "You can ask us for a copy of your data, to correct it, to delete your account, or to stop a particular processing, and you can withdraw consent at any time. Write to {email} from the address of your account; we answer within 3 × 24 hours as required by law, and act on the request as soon as possible.",
          "If you believe your data is handled unlawfully, you may also complain to the competent Indonesian authority.",
        ],
      },
      {
        heading: "6. Security and transfers",
        paragraphs: [
          "Connections are encrypted (HTTPS), passwords are stored only as salted hashes, and access to the database is restricted. Some of our providers process data outside Indonesia; we use providers that protect it to a standard at least equivalent to Indonesian law.",
        ],
      },
      {
        heading: "7. Children",
        paragraphs: ["The service is not intended for children under 18 without a parent's or guardian's consent."],
      },
      {
        heading: "8. Changes",
        paragraphs: ["We will post any change to this Policy here, with a new date at the top. Contact: {email}."],
      },
    ],
  },
  refunds: {
    title: "Refund Policy",
    short: "Refunds",
    intro:
      "Episodes and passes are digital content that is delivered immediately. By paying, you ask for access to start right away, which is why purchases are generally final. We do refund in the cases below.",
    sections: [
      {
        heading: "1. When we refund",
        paragraphs: [
          "You were charged twice for the same purchase.",
          "The payment was confirmed but access did not open, and we could not fix it within 48 hours of your report.",
          "An episode you bought was not playable for technical reasons on our side and we could not fix it within 7 days of your report.",
          "We closed your account without a breach of the Terms on your side: we refund the unused part of an active pass.",
        ],
      },
      {
        heading: "2. How to ask",
        paragraphs: [
          "Write to {email} within 7 days of the payment, from the email of your account, with the date, amount and payment method. We reply within 2 business days.",
        ],
      },
      {
        heading: "3. How the money comes back",
        paragraphs: [
          "Approved refunds are made to the same payment method through the provider that took the payment (Xendit, DOKU or IXPAY), usually within 14 business days; the time for the money to appear depends on your bank or e-wallet. When a refund is made, access bought with that payment ends.",
        ],
      },
      {
        heading: "4. Passes and cancellation",
        paragraphs: [
          "Passes do not renew automatically, so there is nothing to cancel: access simply ends after 7 days, 30 days or 365 days. Unused days are not refunded except in the cases above.",
        ],
      },
    ],
  },
  cookies: {
    title: "Cookie Policy",
    short: "Cookies",
    intro:
      "Cookies are small files your browser keeps for a website. AN Serials uses its own cookies and the Meta Pixel, which measures its advertising.",
    sections: [
      {
        heading: "1. Necessary cookies (always on)",
        paragraphs: [
          "ds_session: keeps you signed in (30 days).",
          "ds_consent: remembers your cookie choice (1 year).",
          "The language is part of the address (?lang=), not a cookie.",
        ],
      },
      {
        heading: "2. Preference cookies (only if you accept)",
        paragraphs: [
          "ds_favs: your saved series (My List), 1 year.",
          "ds_likes: the episodes and series you liked, 1 year.",
          "If you choose \"Necessary only\", these are kept just for the current visit and are lost when you close the tab.",
        ],
      },
      {
        heading: "3. Meta Pixel (advertising)",
        paragraphs: [
          "Meta Pixel (Meta Platforms): the cookies _fbp and _fbc, up to 90 days. They tell us which ads on Facebook and Instagram bring visitors, sign-ups and purchases.",
          "The pixel sends Meta the pages you open and these events: viewing a series, signing up, opening a payment and a completed purchase with its amount. We do not send your email or password.",
          "The banner choice applies only to our own preference cookies (section 2); the pixel works regardless of it.",
        ],
      },
      {
        heading: "4. Changing your choice",
        paragraphs: [
          "You can delete cookies in your browser settings at any time; the banner will then ask again. Questions: {email}.",
        ],
      },
    ],
  },
  contacts: {
    title: "Contacts",
    short: "Contacts",
    sections: [
      {
        heading: "Operator",
        paragraphs: ["{name}", "{address}"],
      },
      {
        heading: "Support, refunds and data requests",
        paragraphs: ["{email}", "We answer within 2 business days."],
      },
    ],
  },
};
