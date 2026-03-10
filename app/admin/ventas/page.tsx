import VentasTable from "@/app/admin/ventas/VentasTable";
import { getOrdersForAdmin } from "@/src/server/sheets/repository";

export const dynamic = "force-dynamic";

export default async function AdminVentasPage() {
  const orders = await getOrdersForAdmin();

  return (
    <section className="glass-panel rounded-3xl border border-[var(--brand-gold-300)]/25 p-5 shadow-[0_20px_42px_rgba(11,4,24,0.35)]">
      <div className="mb-4 flex items-center justify-between gap-2">
        <h2 className="[font-family:var(--font-brand-display)] text-3xl text-[var(--brand-cream)]">Ventas</h2>
        <span className="rounded-full border border-[var(--brand-gold-300)]/45 bg-[rgba(248,227,176,0.15)] px-2.5 py-1 text-xs font-semibold text-[var(--brand-cream)]">
          {orders.length} registros
        </span>
      </div>

      {orders.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-[var(--brand-gold-300)]/30 bg-[rgba(255,255,255,0.05)] px-4 py-6 text-center text-sm text-[var(--brand-cream)]/80">
          No hay ventas registradas en la hoja.
        </p>
      ) : (
        <VentasTable orders={orders} />
      )}
    </section>
  );
}
