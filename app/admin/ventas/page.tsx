import VentasTable from "@/app/admin/ventas/VentasTable";
import { getOrdersForAdmin } from "@/src/server/sheets/repository";

export const dynamic = "force-dynamic";

export default async function AdminVentasPage() {
  const orders = await getOrdersForAdmin();

  return (
    <section className="pb-1 [font-family:Arial,Helvetica,sans-serif]">
      {orders.length === 0 ? (
        <p className="rounded-lg border border-dashed border-[var(--brand-gold-300)]/30 bg-[rgba(255,255,255,0.05)] px-4 py-6 text-center text-sm text-[var(--brand-cream)]/80">
          No hay ventas registradas en la hoja.
        </p>
      ) : (
        <VentasTable orders={orders} />
      )}
    </section>
  );
}
