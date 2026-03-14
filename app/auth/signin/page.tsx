"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";
import { Suspense, useEffect, useState } from "react";

type ProviderPayload = Record<string, { id?: string }>;

export default function AdminSignInPage() {
  return (
    <Suspense fallback={<SignInFallback />}>
      <AdminSignInContent />
    </Suspense>
  );
}

function SignInFallback() {
  return (
    <main className="relative min-h-screen overflow-hidden bg-[radial-gradient(115%_90%_at_10%_10%,rgba(216,191,255,0.26)_0%,transparent_55%),radial-gradient(90%_70%_at_90%_20%,rgba(246,215,150,0.12)_0%,transparent_58%),linear-gradient(180deg,#4d3180_0%,#6f4ea6_58%,#8a6abb_100%)] px-4 py-8 text-[var(--brand-cream)] sm:py-12">
      <section className="relative mx-auto w-full max-w-5xl">
        <article className="rounded-3xl border border-[var(--brand-gold-300)]/34 bg-[rgba(26,13,48,0.92)] p-6 text-sm text-[var(--brand-cream)]/78 shadow-[0_24px_58px_rgba(7,4,18,0.5)] sm:p-8">
          Cargando acceso de administrador...
        </article>
      </section>
    </main>
  );
}

function AdminSignInContent() {
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("callbackUrl") || "/admin";
  const [isGoogleAvailable, setIsGoogleAvailable] = useState<boolean | null>(null);
  const [isSigningIn, setIsSigningIn] = useState(false);

  useEffect(() => {
    let mounted = true;

    const loadProviders = async () => {
      try {
        const response = await fetch("/api/auth/providers", { cache: "no-store" });
        const payload = (await response.json().catch(() => ({}))) as ProviderPayload;
        if (!mounted) return;
        setIsGoogleAvailable(Boolean(payload.google?.id));
      } catch {
        if (!mounted) return;
        setIsGoogleAvailable(false);
      }
    };

    void loadProviders();

    return () => {
      mounted = false;
    };
  }, []);

  const handleGoogleSignIn = async () => {
    setIsSigningIn(true);
    await signIn("google", { callbackUrl });
    setIsSigningIn(false);
  };

  const googleButtonLabel = isSigningIn
    ? "Redirigiendo..."
    : isGoogleAvailable === null
      ? "Verificando acceso..."
      : "Ingresar con Google";

  return (
    <main className="relative min-h-screen overflow-hidden bg-[radial-gradient(115%_90%_at_10%_10%,rgba(216,191,255,0.26)_0%,transparent_55%),radial-gradient(90%_70%_at_90%_20%,rgba(246,215,150,0.12)_0%,transparent_58%),linear-gradient(180deg,#4d3180_0%,#6f4ea6_58%,#8a6abb_100%)] px-4 py-8 text-[var(--brand-cream)] sm:py-12">
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(120deg,rgba(255,255,255,0.07)_0%,transparent_42%,rgba(0,0,0,0.14)_100%)]" />

      <section className="relative mx-auto w-full max-w-5xl">
        <div className="grid items-stretch gap-5 md:grid-cols-[1.1fr_0.9fr]">
          <article className="flex flex-col justify-between rounded-3xl border border-[var(--brand-gold-300)]/28 bg-[rgba(44,23,74,0.56)] p-6 shadow-[0_24px_60px_rgba(10,5,24,0.35)] backdrop-blur-[2px] sm:p-8">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.15em] text-[var(--brand-gold-300)]/88">
                Administracion
              </p>
              <h1 className="mt-2 [font-family:var(--font-brand-display)] text-4xl leading-tight sm:text-5xl">
                Panel Estilo Sol
              </h1>
              <p className="mt-4 max-w-md text-sm leading-relaxed text-[var(--brand-cream)]/84 sm:text-[15px]">
                Gestiona ventas y productos desde un acceso seguro con cuenta Google autorizada.
              </p>
            </div>

            <ul className="mt-6 space-y-2.5 text-sm text-[var(--brand-cream)]/86">
              <li className="flex items-start gap-2">
                <span className="mt-1 h-1.5 w-1.5 rounded-full bg-[var(--brand-gold-300)]" />
                Solo el correo administrador puede ingresar.
              </li>
              <li className="flex items-start gap-2">
                <span className="mt-1 h-1.5 w-1.5 rounded-full bg-[var(--brand-gold-300)]" />
                Los cambios se guardan en tiempo real en el panel.
              </li>
            </ul>

            <Link
              href="/"
              className="mt-7 inline-flex w-fit items-center gap-2 rounded-lg border border-[var(--brand-gold-300)]/42 px-3 py-2 text-xs font-semibold uppercase tracking-[0.08em] text-[var(--brand-cream)] transition hover:bg-white/10"
            >
              Volver al inicio
            </Link>
          </article>

          <article className="rounded-3xl border border-[var(--brand-gold-300)]/34 bg-[rgba(26,13,48,0.92)] p-6 shadow-[0_24px_58px_rgba(7,4,18,0.5)] sm:p-8">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--brand-gold-300)]/90">
              Acceso administrador
            </p>
            <h2 className="mt-2 [font-family:var(--font-brand-display)] text-3xl text-[var(--brand-cream)]">
              Iniciar sesion
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-[var(--brand-cream)]/78">
              Inicia sesion con Google usando el correo autorizado para administrar la tienda.
            </p>

            {isGoogleAvailable === false ? (
              <div className="mt-5 rounded-2xl border border-amber-300/42 bg-amber-100/12 p-4 text-sm leading-relaxed text-amber-100">
                El proveedor de autenticacion no esta disponible en este momento. Intenta nuevamente en unos minutos.
              </div>
            ) : null}

            <button
              type="button"
              onClick={() => void handleGoogleSignIn()}
              disabled={isGoogleAvailable !== true || isSigningIn}
              className="mt-6 flex w-full items-center justify-center gap-2 rounded-2xl bg-[var(--brand-gold-300)] px-4 py-3 text-sm font-bold text-[#22123b] shadow-[inset_0_1px_0_rgba(255,255,255,0.5)] transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-65"
            >
              <svg
                viewBox="0 0 20 20"
                fill="none"
                aria-hidden
                className="h-4 w-4"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M10 3.2a6.8 6.8 0 1 0 4.9 11.5" />
                <path d="M10 10h6.6" />
              </svg>
              {googleButtonLabel}
            </button>

            <p className="mt-3 text-xs text-[var(--brand-cream)]/66">
              Si tu cuenta no esta autorizada, el acceso sera denegado automaticamente.
            </p>
          </article>
        </div>
      </section>
    </main>
  );
}
