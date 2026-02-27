import type { BookingService } from "../../../domain/entities/Booking";

const formatMoney = (value: number) =>
  new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    maximumFractionDigits: 0,
  }).format(value);

type Props = {
  services: BookingService[];
  selectedServiceId: string;
  onSelect: (serviceId: string) => void;
};

export default function ServicePicker({ services, selectedServiceId, onSelect }: Props) {
  return (
    <section className="rounded-3xl border border-white/10 bg-white/5 p-5 md:p-6">
      <h2 className="text-lg font-semibold text-[var(--brand-cream)]">Elegí tu servicio</h2>
      <p className="mt-1 text-sm text-[var(--brand-cream)]/70">Seleccioná una opción para continuar con la reserva.</p>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        {services.map((service) => {
          const selected = selectedServiceId === service.id;
          return (
            <button
              key={service.id}
              type="button"
              onClick={() => onSelect(service.id)}
              className={`rounded-2xl border p-4 text-left transition ${
                selected
                  ? "border-[var(--brand-gold-400)] bg-white/12"
                  : "border-white/15 bg-white/5 hover:border-[var(--brand-gold-300)] hover:bg-white/10"
              }`}
            >
              <p className="text-sm uppercase tracking-[0.12em] text-[var(--brand-gold-300)]">{service.durationMinutes} min</p>
              <h3 className="mt-1 text-base font-semibold text-[var(--brand-cream)]">{service.name}</h3>
              <p className="mt-1 text-sm text-[var(--brand-cream)]/75">{service.description}</p>
              <p className="mt-3 font-semibold text-[var(--brand-gold-300)]">{formatMoney(service.price)}</p>
            </button>
          );
        })}
      </div>
    </section>
  );
}

