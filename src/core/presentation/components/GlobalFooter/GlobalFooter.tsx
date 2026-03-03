import Link from "next/link";

const primaryLinks = [
  { label: "Inicio", href: "/" },
  { label: "Turnos", href: "/turnos" },
  { label: "Tienda", href: "/tienda" },
];

const supportLinks = [
  { label: "Preguntas Frecuentes", href: "/preguntas-frecuentes" },
  { label: "Contacto y Redes", href: "/contacto" },
];

const socialLinks = [
  { label: "Instagram" },
  { label: "WhatsApp" },
];

const whatsappHref =
  "https://wa.me/5493416888926?text=Hola%20Estilo%20Sol%2C%20quisiera%20consultar%20sobre%20";

export default function GlobalFooter() {
  const year = new Date().getFullYear();

  return (
    <footer className="relative z-40 border-t border-[var(--brand-gold-400)]/25 bg-[var(--brand-violet-950)] text-[var(--brand-cream)]">
      <div className="mx-auto w-full max-w-6xl px-5 pb-[calc(1.25rem+var(--safe-area-bottom))] pt-3 md:px-8 md:pb-7 md:pt-4 xl:px-8">
        <div className="grid gap-6 md:grid-cols-[1.35fr_1fr_1fr_0.85fr] md:gap-8">
          <section className="md:flex md:flex-col md:items-center md:text-center">
            <h2 className="text-2xl font-semibold text-[var(--brand-gold-300)]">Estilo Sol</h2>
            <p className="mt-2 text-xs uppercase tracking-[0.18em] text-[var(--brand-cream)]/75">
              Estilo y Cuidado
            </p>
            <p className="mx-auto mt-4 max-w-[46ch] text-sm leading-relaxed text-[var(--brand-cream)]/78">
              Belleza, bienestar y productos seleccionados para acompañar tu estilo todos los días.
            </p>
          </section>

          <section className="md:flex md:flex-col md:items-center md:text-center">
            <h3 className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--brand-gold-300)]/95">
              Navegación
            </h3>
            <nav aria-label="Links principales del footer" className="mt-4 flex flex-col gap-2.5 md:items-center">
              {primaryLinks.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className="text-sm text-[var(--brand-cream)]/85 transition hover:text-[var(--brand-gold-300)]"
                >
                  {link.label}
                </Link>
              ))}
            </nav>
          </section>

          <section className="md:flex md:flex-col md:items-center md:text-center">
            <h3 className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--brand-gold-300)]/95">
              Información
            </h3>
            <nav aria-label="Links informativos del footer" className="mt-4 flex flex-col gap-2.5 md:items-center">
              {supportLinks.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className="text-sm text-[var(--brand-cream)]/85 transition hover:text-[var(--brand-gold-300)]"
                >
                  {link.label}
                </Link>
              ))}
            </nav>
          </section>

          <section className="md:flex md:flex-col md:items-center md:text-center">
            <h3 className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--brand-gold-300)]/95">
              Redes
            </h3>
            <div className="mt-4 flex items-center gap-4">
              {socialLinks.map((social) => (
                social.label === "WhatsApp" ? (
                  <a
                    key={social.label}
                    href={whatsappHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label="WhatsApp"
                    title="Abrir WhatsApp"
                    className="inline-flex h-11 w-11 items-center justify-center text-[var(--brand-cream)]/75 transition hover:text-[var(--brand-gold-300)]"
                  >
                    <svg
                      viewBox="0 0 24 24"
                      className="h-7 w-7 overflow-visible"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <path d="M20 11.6a8 8 0 0 1-11.8 7.1L4 20l1.3-4.2A8 8 0 1 1 20 11.6Z" />
                      <path d="m9.4 9.3.5 1.2c.1.2 0 .4-.1.5l-.3.4c-.1.1-.1.3 0 .5.2.4.6.9 1.2 1.4.7.5 1.2.8 1.6.9.2.1.3.1.4-.1l.5-.6c.2-.2.3-.2.5-.1l1.1.5c.2.1.3.2.3.4v.2c0 .3-.2.6-.4.8-.3.2-.7.3-1.1.3-.7 0-1.6-.3-2.6-.9-1.1-.7-2.2-2-2.5-2.8-.3-.7-.3-1.4-.1-1.8.2-.3.4-.5.7-.5h.4c.2 0 .3.1.4.3Z" />
                    </svg>
                  </a>
                ) : (
                  <span
                    key={social.label}
                    aria-label={social.label}
                    title={`${social.label} (próximamente)`}
                    className="inline-flex h-11 w-11 cursor-not-allowed items-center justify-center text-[var(--brand-cream)]/75"
                  >
                    <svg
                      viewBox="0 0 24 24"
                      className="h-7 w-7 overflow-visible"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <rect x="3.5" y="3.5" width="17" height="17" rx="4.5" />
                      <circle cx="12" cy="12" r="4" />
                      <circle cx="17.4" cy="6.6" r="0.9" fill="currentColor" stroke="none" />
                    </svg>
                  </span>
                )
              ))}
            </div>
          </section>
        </div>

        <div className="mt-5 border-t border-[var(--brand-gold-400)]/20 pt-3 text-center text-xs text-[var(--brand-cream)]/65">
          <p>© {year} Estilo Sol. Todos los derechos reservados.</p>
        </div>
      </div>
    </footer>
  );
}
