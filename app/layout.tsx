import type { Metadata } from "next";
import { Geist_Mono, Parisienne, Playfair_Display } from "next/font/google";
import "./globals.css";
import brandConfig from "@/src/config/brand";
import Navbar from "@/src/core/presentation/components/Navbar/Navbar";
import { CartDrawerProvider } from "@/src/features/shop/presentation/view-models/useCartDrawer";
import { CartProvider } from "@/src/features/shop/presentation/view-models/useCartStore";
import FloatingCartButton from "@/src/features/shop/presentation/components/FloatingCartButton/FloatingCartButton";
import { CartBadgeVisibilityProvider } from "@/src/features/shop/presentation/view-models/useCartBadgeVisibility";

const brandDisplay = Parisienne({
  variable: "--font-brand-display",
  subsets: ["latin"],
  weight: ["400"],
});

const brandBody = Playfair_Display({
  variable: "--font-brand-body",
  subsets: ["latin"],
  weight: ["400", "600"],
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
      <body className={`${brandDisplay.variable} ${brandBody.variable} ${geistMono.variable} antialiased bg-[var(--brand-violet-950)]`}>
        <style dangerouslySetInnerHTML={{ __html: cssVars }} />
        <CartProvider>
          <CartDrawerProvider>
            <CartBadgeVisibilityProvider>
              <Navbar />
              <FloatingCartButton />
              {children}
            </CartBadgeVisibilityProvider>
          </CartDrawerProvider>
        </CartProvider>
      </body>
    </html>
  );
}
