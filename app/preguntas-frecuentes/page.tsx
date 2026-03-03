export default function PreguntasFrecuentesPage() {
  return (
    <main className="min-h-screen bg-[var(--brand-violet-950)] text-[var(--brand-cream)]">
      <div className="mx-auto w-full max-w-4xl px-4 py-10 md:px-8 md:py-14">
        <h1 className="text-3xl font-semibold md:text-4xl">Preguntas Frecuentes</h1>
        <p className="mt-3 text-[var(--brand-cream)]/80">
          Esta página queda lista como base para sumar respuestas frecuentes sobre turnos, pagos, envíos y retiro.
        </p>

        <section className="mt-8 rounded-2xl border border-[var(--brand-gold-300)]/25 bg-white/5 p-5">
          <h2 className="text-lg font-semibold text-[var(--brand-gold-300)]">Estructura inicial</h2>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-[var(--brand-cream)]/85">
            <li>Turnos: disponibilidad, cancelaciones y medios de contacto.</li>
            <li>Tienda: medios de pago, retiro, cambios y stock.</li>
            <li>Soporte: tiempos de respuesta y canales oficiales.</li>
          </ul>
        </section>
      </div>
    </main>
  );
}
