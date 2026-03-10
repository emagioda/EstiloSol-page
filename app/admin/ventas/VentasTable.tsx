"use client";

import type { FormEvent } from "react";
import { useEffect, useMemo, useState } from "react";
import { updateOrderStatusesAction } from "@/app/admin/actions";
import type { AdminOrderSheetRow } from "@/src/server/sheets/repository";

type VentasTableProps = {
  orders: AdminOrderSheetRow[];
};

type PaymentStatus = AdminOrderSheetRow["paymentStatus"];
type ShippingStatus = AdminOrderSheetRow["shippingStatus"];

type OrderDraft = {
  paymentStatus: PaymentStatus;
  shippingStatus: ShippingStatus;
};

const moneyFormatter = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
  maximumFractionDigits: 0,
});

const dateFormatter = new Intl.DateTimeFormat("es-AR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

const paymentBadgeClass = {
  pending: "border-amber-300/65 bg-amber-100 text-amber-900",
  confirmed: "border-emerald-300/65 bg-emerald-100 text-emerald-900",
  cancelled: "border-rose-300/65 bg-rose-100 text-rose-900",
} as const;

const shippingBadgeClass = {
  in_process: "border-sky-300/65 bg-sky-100 text-sky-900",
  completed: "border-violet-300/65 bg-violet-100 text-violet-900",
} as const;

const formatDate = (value: string) => {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return dateFormatter.format(date);
};

const toWaLink = (value: string) => {
  const digits = value.replace(/\D/g, "");
  if (!digits) return null;
  return `https://wa.me/${digits}`;
};

const paymentMethodLabel = (value: AdminOrderSheetRow["paymentMethod"]) => {
  if (value === "cash") return "Efectivo";
  if (value === "transfer") return "Transferencia";
  if (value === "mercadopago") return "Mercado Pago";
  return "No informado";
};

const deliveryMethodLabel = (value: AdminOrderSheetRow["deliveryMethod"]) => {
  if (value === "delivery") return "Envio a domicilio";
  if (value === "pickup") return "Punto de retiro";
  return "No informado";
};

const buildDraftMap = (orders: AdminOrderSheetRow[]) =>
  Object.fromEntries(
    orders.map((order) => [
      order.orderId,
      {
        paymentStatus: order.paymentStatus,
        shippingStatus: order.shippingStatus,
      },
    ])
  ) as Record<string, OrderDraft>;

const toPaymentStatus = (value: FormDataEntryValue | null): PaymentStatus | null => {
  if (value === "pending" || value === "confirmed" || value === "cancelled") {
    return value;
  }
  return null;
};

const toShippingStatus = (value: FormDataEntryValue | null): ShippingStatus | null => {
  if (value === "in_process" || value === "completed") {
    return value;
  }
  return null;
};

export default function VentasTable({ orders }: VentasTableProps) {
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [draftByOrder, setDraftByOrder] = useState<Record<string, OrderDraft>>(() =>
    buildDraftMap(orders)
  );

  useEffect(() => {
    setDraftByOrder(buildDraftMap(orders));
  }, [orders]);

  const selectedOrder = useMemo(
    () => orders.find((order) => order.orderId === selectedOrderId) || null,
    [orders, selectedOrderId]
  );

  const updateDraft = (orderId: string, patch: Partial<OrderDraft>) => {
    setDraftByOrder((previous) => {
      const current = previous[orderId] || {
        paymentStatus: "pending",
        shippingStatus: "in_process",
      };
      return {
        ...previous,
        [orderId]: {
          ...current,
          ...patch,
        },
      };
    });
  };

  const hasChanges = (order: AdminOrderSheetRow, draft: OrderDraft) =>
    order.paymentStatus !== draft.paymentStatus ||
    order.shippingStatus !== draft.shippingStatus;

  const handleSubmitConfirm = (order: AdminOrderSheetRow, event: FormEvent<HTMLFormElement>) => {
    const formData = new FormData(event.currentTarget);
    const nextPaymentStatus = toPaymentStatus(formData.get("paymentStatus"));
    const nextShippingStatus = toShippingStatus(formData.get("shippingStatus"));

    if (!nextPaymentStatus || !nextShippingStatus) {
      event.preventDefault();
      return;
    }

    const changed =
      order.paymentStatus !== nextPaymentStatus ||
      order.shippingStatus !== nextShippingStatus;

    if (!changed) {
      event.preventDefault();
      window.alert("No hay cambios para guardar en esta venta.");
      return;
    }

    const confirmingPayment =
      order.paymentStatus !== "confirmed" && nextPaymentStatus === "confirmed";
    const warning = confirmingPayment
      ? "Esto marcara el pago como Confirmado y enviara el email de comprobante. "
      : "";
    const confirmed = window.confirm(
      `${warning}Se actualizaran los estados de la venta ${order.orderId}. Deseas continuar?`
    );

    if (!confirmed) {
      event.preventDefault();
    }
  };

  return (
    <>
      <div className="overflow-x-auto rounded-2xl border border-[var(--brand-gold-300)]/25 bg-[rgba(255,255,255,0.95)] shadow-[0_16px_30px_rgba(12,6,24,0.25)]">
        <table className="min-w-[1120px] w-full text-left">
          <thead className="bg-[var(--brand-violet-900)] text-[var(--brand-cream)]">
            <tr className="text-xs uppercase tracking-[0.1em]">
              <th className="px-3 py-3">ID Venta</th>
              <th className="px-3 py-3">Fecha</th>
              <th className="px-3 py-3">Cliente</th>
              <th className="px-3 py-3">WhatsApp</th>
              <th className="px-3 py-3">Total</th>
              <th className="px-3 py-3">Estado Pago</th>
              <th className="px-3 py-3">Estado Envio</th>
              <th className="px-3 py-3 text-right">Detalle</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--brand-violet-700)]/12 bg-white text-[13px] text-[var(--brand-violet-950)]">
            {orders.map((order) => {
              const waLink = toWaLink(order.whatsapp);
              const formId = `venta-form-${order.orderId}`;
              const draft = draftByOrder[order.orderId] || {
                paymentStatus: order.paymentStatus,
                shippingStatus: order.shippingStatus,
              };
              const rowHasChanges = hasChanges(order, draft);

              return (
                <tr key={order.orderId} className="align-top">
                  <td className="px-3 py-3">
                    <span className="font-semibold">{order.orderId}</span>
                  </td>
                  <td className="px-3 py-3">{formatDate(order.createdAt)}</td>
                  <td className="px-3 py-3">{order.customerName || "-"}</td>
                  <td className="px-3 py-3">
                    {waLink ? (
                      <a
                        href={waLink}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[var(--brand-violet-700)] underline decoration-dotted underline-offset-3"
                      >
                        {order.whatsapp}
                      </a>
                    ) : (
                      "-"
                    )}
                  </td>
                  <td className="px-3 py-3">{moneyFormatter.format(order.total)}</td>
                  <td className="px-3 py-3">
                    <select
                      form={formId}
                      name="paymentStatus"
                      value={draft.paymentStatus}
                      onChange={(event) =>
                        updateDraft(order.orderId, {
                          paymentStatus: event.target.value as PaymentStatus,
                        })
                      }
                      className={`w-full min-w-[140px] rounded-lg border px-2 py-1.5 text-xs font-semibold ${paymentBadgeClass[draft.paymentStatus]}`}
                    >
                      <option value="pending">Pendiente</option>
                      <option value="confirmed">Confirmado</option>
                      <option value="cancelled">Cancelado</option>
                    </select>
                  </td>
                  <td className="px-3 py-3">
                    <select
                      form={formId}
                      name="shippingStatus"
                      value={draft.shippingStatus}
                      onChange={(event) =>
                        updateDraft(order.orderId, {
                          shippingStatus: event.target.value as ShippingStatus,
                        })
                      }
                      className={`w-full min-w-[140px] rounded-lg border px-2 py-1.5 text-xs font-semibold ${shippingBadgeClass[draft.shippingStatus]}`}
                    >
                      <option value="in_process">En proceso</option>
                      <option value="completed">Finalizado</option>
                    </select>
                  </td>
                  <td className="px-3 py-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <form
                        id={formId}
                        action={updateOrderStatusesAction}
                        onSubmit={(event) => handleSubmitConfirm(order, event)}
                      >
                        <input type="hidden" name="orderId" value={order.orderId} />
                        <input type="hidden" name="redirectTo" value="/admin/ventas" />
                        <button
                          type="submit"
                          disabled={!rowHasChanges}
                          className="rounded-lg bg-[var(--brand-gold-300)] px-2.5 py-1.5 text-xs font-semibold text-[var(--brand-violet-950)] transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-55"
                        >
                          Guardar cambios
                        </button>
                      </form>
                      <button
                        type="button"
                        onClick={() => setSelectedOrderId(order.orderId)}
                        className="rounded-lg border border-[var(--brand-violet-700)]/25 bg-[var(--brand-violet-700)]/8 px-2.5 py-1.5 text-xs font-semibold text-[var(--brand-violet-900)] transition hover:bg-[var(--brand-violet-700)]/15"
                      >
                        Ver detalle
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {selectedOrder && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-[rgba(10,5,20,0.7)] p-4">
          <div className="w-full max-w-2xl rounded-3xl border border-[var(--brand-gold-300)]/35 bg-[var(--brand-violet-950)] p-5 text-[var(--brand-cream)] shadow-[0_24px_52px_rgba(4,2,10,0.55)]">
            <div className="mb-4 flex items-start justify-between gap-4 border-b border-[var(--brand-gold-300)]/20 pb-4">
              <div>
                <p className="text-xs uppercase tracking-[0.12em] text-[var(--brand-gold-300)]/85">Detalle de venta</p>
                <h3 className="[font-family:var(--font-brand-display)] text-2xl">{selectedOrder.orderId}</h3>
              </div>
              <button
                type="button"
                onClick={() => setSelectedOrderId(null)}
                className="rounded-full border border-[var(--brand-gold-300)]/40 p-2 text-[var(--brand-cream)] transition hover:bg-white/10"
                aria-label="Cerrar detalle"
              >
                X
              </button>
            </div>

            <div className="grid gap-3 text-sm text-[var(--brand-cream)]/90 sm:grid-cols-2">
              <p>
                <span className="text-[var(--brand-cream)]/65">Fecha:</span> {formatDate(selectedOrder.createdAt)}
              </p>
              <p>
                <span className="text-[var(--brand-cream)]/65">Total:</span> {moneyFormatter.format(selectedOrder.total)}
              </p>
              <p>
                <span className="text-[var(--brand-cream)]/65">Cliente:</span> {selectedOrder.customerName || "-"}
              </p>
              <p>
                <span className="text-[var(--brand-cream)]/65">WhatsApp:</span> {selectedOrder.whatsapp || "-"}
              </p>
              <p className="sm:col-span-2">
                <span className="text-[var(--brand-cream)]/65">Email:</span> {selectedOrder.email || "-"}
              </p>
              <p>
                <span className="text-[var(--brand-cream)]/65">Forma de pago:</span>{" "}
                {paymentMethodLabel(selectedOrder.paymentMethod)}
              </p>
              <p>
                <span className="text-[var(--brand-cream)]/65">Forma de entrega:</span>{" "}
                {deliveryMethodLabel(selectedOrder.deliveryMethod)}
              </p>
            </div>

            <div className="mt-5 rounded-2xl border border-[var(--brand-gold-300)]/20 bg-[rgba(255,255,255,0.05)] p-4">
              <h4 className="text-sm font-semibold uppercase tracking-[0.12em] text-[var(--brand-gold-300)]">Items comprados</h4>
              {selectedOrder.items.length > 0 ? (
                <ul className="mt-2 space-y-2 text-sm">
                  {selectedOrder.items.map((item, index) => (
                    <li key={`${item.title}-${index}`} className="flex items-center justify-between gap-3 border-b border-white/10 pb-2 last:border-b-0 last:pb-0">
                      <span className="text-[var(--brand-cream)]/90">
                        {item.qty}x {item.title}
                      </span>
                      <span className="text-xs text-[var(--brand-gold-300)]">
                        {typeof item.unitPrice === "number" ? moneyFormatter.format(item.unitPrice) : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : selectedOrder.itemsSummary ? (
                <p className="mt-2 text-sm text-[var(--brand-cream)]/85">{selectedOrder.itemsSummary}</p>
              ) : (
                <p className="mt-2 text-sm text-[var(--brand-cream)]/65">No hay detalle de items disponible.</p>
              )}
            </div>

            <div className="mt-4 rounded-2xl border border-[var(--brand-gold-300)]/20 bg-[rgba(255,255,255,0.04)] p-4">
              <h4 className="text-sm font-semibold uppercase tracking-[0.12em] text-[var(--brand-gold-300)]">Notas</h4>
              <p className="mt-1 text-sm text-[var(--brand-cream)]/85">{selectedOrder.notes || "Sin notas."}</p>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

