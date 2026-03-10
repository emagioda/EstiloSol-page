"use client";

import Link from "next/link";
import { signIn } from "next-auth/react";
import { useEffect, useState } from "react";

type ProviderPayload = Record<string, { id?: string }>;

export default function AdminSignInPage() {
  const [callbackUrl, setCallbackUrl] = useState("/admin");
  const [isGoogleAvailable, setIsGoogleAvailable] = useState<boolean | null>(null);
  const [isSigningIn, setIsSigningIn] = useState(false);

  useEffect(() => {
    let mounted = true;

    const callbackParam = new URLSearchParams(window.location.search).get("callbackUrl");
    if (callbackParam) {
      setCallbackUrl(callbackParam);
    }

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

  return (
    <main className="min-h-screen bg-[var(--brand-violet-950)] px-4 py-10 text-[var(--brand-cream)]">
      <section className="mx-auto w-full max-w-lg rounded-3xl border border-[var(--brand-gold-300)]/30 bg-[rgba(28,16,53,0.9)] p-6 shadow-[0_20px_50px_rgba(7,4,16,0.45)]">
        <p className="text-xs uppercase tracking-[0.14em] text-[var(--brand-gold-300)]/85">Acceso administrador</p>
        <h1 className="[font-family:var(--font-brand-display)] text-3xl text-[var(--brand-cream)]">Panel Estilo Sol</h1>
        <p className="mt-3 text-sm text-[var(--brand-cream)]/78">
          Inicia sesion con Google usando el correo administrador autorizado.
        </p>

        {isGoogleAvailable === false ? (
          <div className="mt-5 rounded-2xl border border-amber-300/40 bg-amber-100/10 p-4 text-sm text-amber-100">
            No hay proveedor de Google configurado. Revisa <code>GOOGLE_CLIENT_ID</code> y{" "}
            <code>GOOGLE_CLIENT_SECRET</code> en el entorno del servidor.
          </div>
        ) : null}

        <button
          type="button"
          onClick={() => void handleGoogleSignIn()}
          disabled={isGoogleAvailable !== true || isSigningIn}
          className="mt-6 w-full rounded-2xl bg-[var(--brand-gold-300)] px-4 py-3 text-sm font-semibold text-[var(--brand-violet-950)] transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-65"
        >
          {isSigningIn ? "Redirigiendo..." : "Ingresar con Google"}
        </button>

        <Link
          href="/"
          className="mt-3 inline-flex text-xs text-[var(--brand-cream)]/75 underline decoration-dotted underline-offset-3"
        >
          Volver al inicio
        </Link>
      </section>
    </main>
  );
}
