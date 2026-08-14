import VentasTable from "@/app/admin/ventas/VentasTable";
import {
  getOrdersForAdminWithKvState,
  getRecoveryAttentionForAdmin,
} from "@/src/server/orders/admin";

export const dynamic = "force-dynamic";

export default async function AdminVentasPage() {
  const [orders, recoveryAttention] = await Promise.all([
    getOrdersForAdminWithKvState(),
    getRecoveryAttentionForAdmin(),
  ]);

  return (
    <section className="pb-1 [font-family:Arial,Helvetica,sans-serif]">
      {recoveryAttention.length > 0 ? (
        <aside className="mb-4 rounded-xl border border-amber-300/50 bg-amber-100 px-4 py-3 text-sm text-amber-950">
          <p className="font-bold">
            Recuperación de pagos: {recoveryAttention.length} evento(s) requieren seguimiento
          </p>
          <ul className="mt-2 space-y-1 text-xs">
            {recoveryAttention.slice(0, 10).map((item, index) => (
              <li key={`${item.kind}-${item.paymentId ?? item.externalReference}-${index}`}>
                {item.externalReference || "Sin referencia"}
                {item.paymentId ? ` · pago ${item.paymentId}` : ""}
                {item.financialStatus ? ` · ${item.financialStatus}` : ""}
                {` · ${item.state}`}
                {item.lastErrorCode ? ` · ${item.lastErrorCode}` : ""}
              </li>
            ))}
          </ul>
        </aside>
      ) : null}
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
