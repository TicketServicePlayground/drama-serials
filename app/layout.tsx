import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque, Inter, Manrope } from "next/font/google";
import { preconnect } from "react-dom";
import { CDN_ORIGIN } from "@/lib/images";
import { CookieBanner } from "@/components/CookieBanner";
import { VisitCounter } from "@/components/VisitCounter";
import { MetaPixel } from "@/components/MetaPixel";
import { pageMetadata } from "@/lib/seo";
import { getLocale } from "@/lib/locale";
import "./globals.css";

const inter = Inter({ variable: "--font-inter", subsets: ["latin", "cyrillic"] });
// No metric-adjusted Arial fallback here: it has Cyrillic and would catch Russian glyphs before Manrope.
const brand = Bricolage_Grotesque({
  variable: "--font-brand",
  weight: ["500", "800"],
  subsets: ["latin"],
  adjustFontFallback: false,
  fallback: [],
});
// Bricolage has no Cyrillic: Russian display text falls through to Manrope, loaded only for those glyphs.
const brandCyrillic = Manrope({ variable: "--font-brand-cyrillic", weight: ["500", "800"], subsets: ["cyrillic"], preload: false });

export async function generateMetadata(): Promise<Metadata> {
  return pageMetadata(await getLocale(), "/");
}

export const viewport: Viewport = { themeColor: "#0D0D12" };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  // Read at runtime, so the pixel can be set in the server .env without a rebuild.
  const pixelId = /^\d{5,20}$/.test(process.env.META_PIXEL_ID ?? "") ? process.env.META_PIXEL_ID! : null;
  // Open the CDN connection while the HTML is still parsing.
  preconnect(CDN_ORIGIN);
  return (
    <html lang={locale} className={`${inter.variable} ${brand.variable} ${brandCyrillic.variable} dark h-full antialiased`}>
      <body className="flex min-h-full flex-col bg-background text-foreground">
        {children}
        <CookieBanner locale={locale} />
        <VisitCounter />
        {pixelId && <MetaPixel pixelId={pixelId} />}
      </body>
    </html>
  );
}
