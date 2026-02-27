"use client";

import BookingCard from "../components/BookingCard/BookingCard";
import ServicePicker from "../components/ServicePicker/ServicePicker";
import { useBooking } from "../view-models/useBooking";

export default function TurnosPage() {
  const {
    services,
    slots,
    form,
    loading,
    submitting,
    error,
    successMessage,
    selectedService,
    lastBooking,
    setField,
    submitBooking,
  } = useBooking();

  return (
    <main className="min-h-screen bg-[var(--brand-violet-950)]">
      <div className="mx-auto w-full max-w-6xl px-4 py-10 text-[var(--brand-cream)] md:py-14">
        <header className="mb-8">
          <h1 className="text-4xl font-semibold md:text-5xl">Reservá tu turno</h1>
          <p className="mt-3 max-w-3xl text-[var(--brand-cream)]/75">
            Elegí el servicio, completá tus datos y te confirmamos por WhatsApp.
          </p>
        </header>

        {error && (
          <div className="mb-5 rounded-xl border border-rose-300/40 bg-rose-900/30 px-4 py-3 text-sm text-[var(--brand-cream)]">
            {error}
          </div>
        )}

        {successMessage && (
          <div className="mb-5 rounded-xl border border-emerald-200/50 bg-emerald-700/30 px-4 py-3 text-sm text-[var(--brand-cream)]">
            {successMessage}
            {lastBooking ? ` Nº ${lastBooking.id.slice(0, 8).toUpperCase()}` : ""}
          </div>
        )}

        {loading ? (
          <div className="rounded-3xl border border-white/10 bg-white/5 p-8 text-center text-[var(--brand-cream)]/80">
            Cargando servicios...
          </div>
        ) : (
          <div className="grid gap-5 lg:grid-cols-2">
            <ServicePicker
              services={services}
              selectedServiceId={form.serviceId}
              onSelect={(serviceId) => setField("serviceId", serviceId)}
            />
            <BookingCard
              form={form}
              slots={slots}
              selectedService={selectedService}
              submitting={submitting}
              onChange={setField}
              onSubmit={() => {
                void submitBooking();
              }}
            />
          </div>
        )}
      </div>
    </main>
  );
}

