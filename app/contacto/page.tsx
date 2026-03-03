"use client";

import { FormEvent, useMemo, useState } from "react";

type FormState = {
  nombre: string;
  telefono: string;
  email: string;
  mensaje: string;
  website: string;
};

const INITIAL_STATE: FormState = {
  nombre: "",
  telefono: "",
  email: "",
  mensaje: "",
  website: "",
};

const socialNetworks = [
  {
    name: "Instagram",
    label: "estilo-sol",
    href: "https://www.instagram.com/estilo-sol",
    icon: "instagram",
  },
  {
    name: "WhatsApp",
    label: "+54 9 341 688-8926",
    href: "https://wa.me/5493416888926?text=Hola%20Estilo%20Sol%2C%20quisiera%20consultar%20sobre%20",
    icon: "whatsapp",
  },
] as const;

export default function ContactoPage() {
  const [form, setForm] = useState<FormState>(INITIAL_STATE);
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "ok" | "error"; text: string } | null>(null);

  const isValid = useMemo(() => {
    return (
      form.nombre.trim().length > 0 &&
      form.telefono.trim().length > 0 &&
      form.email.trim().length > 0 &&
      form.mensaje.trim().length >= 10
    );
  }, [form]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!isValid || submitting) return;

    setSubmitting(true);
    setFeedback(null);

    try {
      const response = await fetch("/api/contact", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(form),
      });

      const data = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string; message?: string };

      if (!response.ok || !data.ok) {
        setFeedback({
          type: "error",
          text: data.error ?? "No se pudo enviar el mensaje. Intentá nuevamente.",
        });
        return;
      }

      setFeedback({ type: "ok", text: data.message ?? "Mensaje enviado correctamente." });
      setForm(INITIAL_STATE);
    } catch {
      setFeedback({
        type: "error",
        text: "No se pudo enviar el mensaje. Revisá tu conexión e intentá nuevamente.",
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="bg-[var(--brand-violet-950)] text-[var(--brand-cream)]">
      <div className="mx-auto w-full max-w-7xl px-4 py-10 md:px-8 md:py-14">
        <div className="grid gap-8 lg:grid-cols-4 lg:gap-6">
          <section className="lg:col-span-3">
            <h1 className="text-3xl font-semibold md:text-4xl">Contacto</h1>
            <p className="mt-3 text-[var(--brand-cream)]/90">
              Completá el formulario y te responderemos a la brevedad.
            </p>

            <form
              onSubmit={handleSubmit}
              className="mt-8 rounded-2xl border border-[var(--brand-gold-300)]/25 bg-white/5 p-5 md:p-6"
            >
              <label className="hidden" aria-hidden="true">
                Website
                <input
                  tabIndex={-1}
                  autoComplete="off"
                  value={form.website}
                  onChange={(e) => setForm((prev) => ({ ...prev, website: e.target.value }))}
                  type="text"
                />
              </label>

              <div className="grid gap-4 md:grid-cols-2">
                <label className="flex flex-col gap-1.5 text-sm">
                  <span className="text-[var(--brand-gold-300)]">Nombre</span>
                  <input
                    value={form.nombre}
                    onChange={(e) => setForm((prev) => ({ ...prev, nombre: e.target.value }))}
                    type="text"
                    required
                    className="rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-[var(--brand-cream)] placeholder:text-[var(--brand-cream)]/45 focus:border-[var(--brand-gold-300)] focus:outline-none"
                    placeholder="Tu nombre"
                  />
                </label>

                <label className="flex flex-col gap-1.5 text-sm">
                  <span className="text-[var(--brand-gold-300)]">Teléfono</span>
                  <input
                    value={form.telefono}
                    onChange={(e) => setForm((prev) => ({ ...prev, telefono: e.target.value }))}
                    type="tel"
                    required
                    className="rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-[var(--brand-cream)] placeholder:text-[var(--brand-cream)]/45 focus:border-[var(--brand-gold-300)] focus:outline-none"
                    placeholder="Tu teléfono"
                  />
                </label>

                <label className="flex flex-col gap-1.5 text-sm md:col-span-2">
                  <span className="text-[var(--brand-gold-300)]">Email</span>
                  <input
                    value={form.email}
                    onChange={(e) => setForm((prev) => ({ ...prev, email: e.target.value }))}
                    type="email"
                    required
                    className="rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-[var(--brand-cream)] placeholder:text-[var(--brand-cream)]/45 focus:border-[var(--brand-gold-300)] focus:outline-none"
                    placeholder="tuemail@ejemplo.com"
                  />
                </label>

                <label className="flex flex-col gap-1.5 text-sm md:col-span-2">
                  <span className="text-[var(--brand-gold-300)]">Mensaje</span>
                  <textarea
                    value={form.mensaje}
                    onChange={(e) => setForm((prev) => ({ ...prev, mensaje: e.target.value }))}
                    required
                    minLength={10}
                    rows={6}
                    className="rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-[var(--brand-cream)] placeholder:text-[var(--brand-cream)]/45 focus:border-[var(--brand-gold-300)] focus:outline-none"
                    placeholder="Contanos cómo podemos ayudarte"
                  />
                </label>
              </div>

              <div className="mt-5 flex items-center justify-between gap-3">
                <button
                  type="submit"
                  disabled={!isValid || submitting}
                  className="rounded-lg bg-[var(--brand-gold-300)] px-5 py-3 text-sm font-semibold text-black shadow-[0_8px_22px_rgba(26,10,48,0.28)] transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {submitting ? "Enviando..." : "Enviar"}
                </button>

                {feedback && (
                  <p
                    className={`text-sm ${
                      feedback.type === "ok" ? "text-emerald-300" : "text-rose-300"
                    }`}
                    role="status"
                    aria-live="polite"
                  >
                    {feedback.text}
                  </p>
                )}
              </div>
            </form>
          </section>

          <aside className="lg:col-span-1 lg:border-l lg:border-[var(--brand-gold-300)]/25 lg:pl-5">
            <h2 className="text-3xl font-semibold md:text-4xl">Redes</h2>
            <p className="mt-3 text-[var(--brand-cream)]/90">
              Visitanos en nuestras redes y conocé las últimas novedades, lanzamientos y propuestas de <span className="whitespace-nowrap">Estilo Sol</span>.
            </p>

            <ul className="mt-8 space-y-4 text-base text-[var(--brand-cream)]/95">
              {socialNetworks.map((network) => (
                <li key={network.name}>
                  <a
                    href={network.href}
                    target="_blank"
                    rel="noreferrer"
                    className="flex flex-wrap items-center gap-2 text-[var(--brand-cream)]/90 transition hover:text-[var(--brand-gold-300)]"
                    aria-label={`${network.name}: ${network.label}`}
                  >
                    {network.icon === "instagram" && (
                      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
                        <rect x="4" y="4" width="16" height="16" rx="4" />
                        <circle cx="12" cy="12" r="3.5" />
                        <circle cx="17" cy="7" r="1" fill="currentColor" stroke="none" />
                      </svg>
                    )}
                    {network.icon === "whatsapp" && (
                      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
                        <path d="M20 11.6A8 8 0 0 1 8.2 18.7L4 20l1.4-4a8 8 0 1 1 14.6-4.4Z" />
                        <path d="M9.6 9.2c.2-.4.4-.4.7-.4h.4c.1 0 .3 0 .4.3l.6 1.4c.1.2.1.3 0 .5l-.3.5c-.1.1-.2.2-.1.4.2.4.6 1 1.3 1.5.8.6 1.4.8 1.7.9.2.1.3 0 .5-.1l.6-.7c.2-.2.3-.2.5-.1l1.2.6c.2.1.3.2.3.4v.3c0 .3-.2.6-.5.8-.3.2-.8.4-1.2.4-.7 0-1.7-.3-2.7-.9-1.2-.8-2.4-2.2-2.7-3-.4-.8-.4-1.5-.2-1.9Z" />
                      </svg>
                    )}
                    <span className="text-[var(--brand-gold-300)]">{network.name}</span>
                    <span>{network.label}</span>
                  </a>
                </li>
              ))}
            </ul>
          </aside>
        </div>
      </div>
    </main>
  );
}
