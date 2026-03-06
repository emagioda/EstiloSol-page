import type { Metadata } from "next";
import { Geist_Mono, Lora } from "next/font/google";
import "./globals.css";
import brandConfig from "@/src/config/brand";
import Navbar from "@/src/core/presentation/components/Navbar/Navbar";
import GlobalFooter from "@/src/core/presentation/components/GlobalFooter/GlobalFooter";
import { CartDrawerProvider } from "@/src/features/shop/presentation/view-models/useCartDrawer";
import { CartProvider } from "@/src/features/shop/presentation/view-models/useCartStore";
import { CartBadgeVisibilityProvider } from "@/src/features/shop/presentation/view-models/useCartBadgeVisibility";
import WebVitalsReporter from "@/src/core/presentation/components/WebVitalsReporter";
import AppToaster from "@/src/core/presentation/components/AppToaster/AppToaster";

const brandDisplay = Lora({
  variable: "--font-brand-display",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
});

const brandBody = Lora({
  variable: "--font-brand-body",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Estilo Sol | Estilo y Cuidado",
  description:
    "Tienda híbrida con Productos Profesionales de peluquería y Diseños Únicos de bijouterie.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const { palette } = brandConfig;

  const cssVars = `:root {
    --safe-area-top: env(safe-area-inset-top, 0px);
    --safe-area-bottom: env(safe-area-inset-bottom, 0px);
    --header-height-mobile-base: 56px;
    --header-height-desktop-base: 72px;
    --shop-ticker-height-mobile: 28px;
    --shop-ticker-height-desktop: 30px;
    --header-height-mobile: calc(var(--header-height-mobile-base) + var(--safe-area-top));
    --header-height-desktop: var(--header-height-desktop-base);
    --brand-violet-950: ${palette.violet.deepest};
    --brand-violet-900: ${palette.violet.deep};
    --brand-violet-800: ${palette.violet.base};
    --brand-violet-700: ${palette.violet.light};
    --brand-violet-500: ${palette.violet.strong};
    --brand-violet-strong: ${palette.violet.strong};
    --brand-gold-600: ${palette.gold.deep};
    --brand-gold-500: ${palette.gold.base};
    --brand-gold-400: ${palette.gold.light};
    --brand-gold-300: ${palette.gold.glow};
    --brand-cream: ${palette.cream};
  }`;

  return (
    <html lang="es">
      <body className={`${brandDisplay.variable} ${brandBody.variable} ${geistMono.variable} min-h-screen antialiased bg-[var(--brand-violet-950)]`}>
        <style dangerouslySetInnerHTML={{ __html: cssVars }} />
        <CartProvider>
          <CartDrawerProvider>
            <CartBadgeVisibilityProvider>
              <div className="flex min-h-screen flex-col">
                <Navbar />
                <WebVitalsReporter />
                <AppToaster />
                <div className="flex min-h-0 flex-1 flex-col pt-[var(--header-height-mobile)] transition-[padding-top] duration-300 ease-out md:pt-[var(--header-height-desktop)]">{children}</div>
                <GlobalFooter />
              </div>
            </CartBadgeVisibilityProvider>
          </CartDrawerProvider>
        </CartProvider>
      </body>
    </html>
  );
}
