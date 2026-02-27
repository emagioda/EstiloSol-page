import type { BookingDTO } from "../../../application/dto/BookingDTO";
import type { BookingService } from "../../../domain/entities/Booking";

type Props = {
  form: BookingDTO;
  slots: string[];
  selectedService: BookingService | null;
  submitting: boolean;
  onChange: <K extends keyof BookingDTO>(key: K, value: BookingDTO[K]) => void;
  onSubmit: () => void;
};

export default function BookingCard({ form, slots, selectedService, submitting, onChange, onSubmit }: Props) {
  return (
    <section className="rounded-3xl border border-white/10 bg-white/5 p-5 md:p-6">
      <h2 className="text-lg font-semibold text-[var(--brand-cream)]">Completá tus datos</h2>
      {selectedService ? (
        <p className="mt-1 text-sm text-[var(--brand-cream)]/70">Reservando: {selectedService.name}</p>
      ) : (
        <p className="mt-1 text-sm text-[var(--brand-cream)]/70">Seleccioná un servicio para reservar.</p>
      )}

      <div className="mt-4 grid gap-3">
        <input
          type="text"
          value={form.customerName}
          onChange={(event) => onChange("customerName", event.target.value)}
          placeholder="Nombre y apellido"
          className="w-full rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-sm text-[var(--brand-cream)] placeholder-[var(--brand-cream)]/60 outline-none focus:border-[var(--brand-gold-300)]"
        />

        <input
          type="tel"
          value={form.customerPhone}
          onChange={(event) => onChange("customerPhone", event.target.value)}
          placeholder="WhatsApp"
          className="w-full rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-sm text-[var(--brand-cream)] placeholder-[var(--brand-cream)]/60 outline-none focus:border-[var(--brand-gold-300)]"
        />

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <input
            type="date"
            value={form.date}
            onChange={(event) => onChange("date", event.target.value)}
            className="w-full rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-sm text-[var(--brand-cream)] outline-none focus:border-[var(--brand-gold-300)]"
          />

          <select
            value={form.timeSlot}
            onChange={(event) => onChange("timeSlot", event.target.value)}
            className="w-full rounded-xl border border-white/20 bg-[var(--brand-violet-900)] px-3 py-2 text-sm text-[var(--brand-cream)] outline-none focus:border-[var(--brand-gold-300)]"
          >
            <option value="">Horario</option>
            {slots.map((slot) => (
              <option key={slot} value={slot}>
                {slot}
              </option>
            ))}
          </select>
        </div>

        <textarea
          value={form.notes}
          onChange={(event) => onChange("notes", event.target.value)}
          placeholder="Notas opcionales"
          rows={3}
          className="w-full rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-sm text-[var(--brand-cream)] placeholder-[var(--brand-cream)]/60 outline-none focus:border-[var(--brand-gold-300)]"
        />
      </div>

      <button
        type="button"
        onClick={onSubmit}
        disabled={submitting || !selectedService}
        className="mt-4 w-full rounded-xl bg-[var(--brand-gold-300)] px-4 py-2.5 font-semibold text-[var(--brand-violet-950)] transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {submitting ? "Reservando..." : "Reservar turno"}
      </button>
    </section>
  );
}

