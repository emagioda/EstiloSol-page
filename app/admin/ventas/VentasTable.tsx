"use client";

import type { FormEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { saveOrderStatusesBatchAction, updateOrderStatusesAction } from "@/app/admin/actions";
import type { AdminOrderSheetRow } from "@/src/server/sheets/repository";
import { useBodyScrollLock } from "@/src/core/presentation/hooks/useBodyScrollLock";

type VentasTableProps = {
  orders: AdminOrderSheetRow[];
};

type PaymentStatus = AdminOrderSheetRow["paymentStatus"];
type ShippingStatus = AdminOrderSheetRow["shippingStatus"];

type OrderDraft = {
  paymentStatus: PaymentStatus;
  shippingStatus: ShippingStatus;
};

type PaymentFilter = "all" | PaymentStatus;
type ShippingFilter = "all" | ShippingStatus;
type SortByOption =
  | "date-desc"
  | "date-asc"
  | "total-desc"
  | "total-asc"
  | "customer-asc"
  | "customer-desc";
type QuickFilter = "all" | "needs-payment" | "needs-shipping" | "completed";

type FilterOption<T extends string> = {
  value: T;
  label: string;
};

type PendingOrderUpdate = {
  orderId: string;
  paymentStatus: PaymentStatus;
  shippingStatus: ShippingStatus;
};

type SaveDialogState =
  | {
      mode: "closed";
    }
  | {
      mode: "info";
      title: string;
      description: string;
    }
  | {
      mode: "confirm";
      title: string;
      description: string;
      orderId: string;
      formId: string;
    }
  | {
      mode: "batchConfirm";
      title: string;
      description: string;
    };

type LeaveDialogState = {
  action: "navigate" | "reload";
  targetHref: string;
} | null;

const moneyFormatter = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
  maximumFractionDigits: 0,
});

const formatMoney = (value: number) => moneyFormatter.format(value).replace(/\$\s+/u, "$");

const dateFormatter = new Intl.DateTimeFormat("es-AR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

const dateOnlyFormatter = new Intl.DateTimeFormat("es-AR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

const paymentBadgeClass = {
  pending: "border-amber-300/65 bg-amber-100 text-amber-900",
  confirmed: "border-emerald-300/65 bg-emerald-100 text-emerald-900",
  cancelled: "border-rose-300/65 bg-rose-100 text-rose-900",
  refunded: "border-slate-300/65 bg-slate-100 text-slate-900",
  charged_back: "border-red-400/70 bg-red-100 text-red-950",
} as const;

const shippingBadgeClass = {
  in_process: "border-sky-300/65 bg-sky-100 text-sky-900",
  completed: "border-violet-300/65 bg-violet-100 text-violet-900",
} as const;

const paymentOptionClass = {
  pending: "bg-amber-100 text-amber-900",
  confirmed: "bg-emerald-100 text-emerald-900",
  cancelled: "bg-rose-100 text-rose-900",
  refunded: "bg-slate-100 text-slate-900",
  charged_back: "bg-red-100 text-red-950",
} as const;

const shippingOptionClass = {
  in_process: "bg-sky-100 text-sky-900",
  completed: "bg-violet-100 text-violet-900",
} as const;

const paymentStatusButtonClass = {
  pending: "border-amber-300/65 bg-amber-100 text-amber-900",
  confirmed: "border-emerald-300/65 bg-emerald-100 text-emerald-900",
  cancelled: "border-rose-300/65 bg-rose-100 text-rose-900",
  refunded: "border-slate-300/65 bg-slate-100 text-slate-900",
  charged_back: "border-red-400/70 bg-red-100 text-red-950",
} as const;

const shippingStatusButtonClass = {
  in_process: "border-sky-300/65 bg-sky-100 text-sky-900",
  completed: "border-violet-300/65 bg-violet-100 text-violet-900",
} as const;

const paymentStatusLabel: Record<PaymentStatus, string> = {
  pending: "Pendiente",
  confirmed: "Confirmado",
  cancelled: "Cancelado",
  refunded: "Reintegrado",
  charged_back: "Contracargo",
};

const shippingStatusLabel: Record<ShippingStatus, string> = {
  in_process: "En proceso",
  completed: "Finalizado",
};

const paymentStatusOptions: Array<{ value: PaymentStatus; label: string }> = [
  { value: "pending", label: "Pendiente" },
  { value: "confirmed", label: "Confirmado" },
  { value: "cancelled", label: "Cancelado" },
  { value: "refunded", label: "Reintegrado" },
  { value: "charged_back", label: "Contracargo" },
];

const shippingStatusOptions: Array<{ value: ShippingStatus; label: string }> = [
  { value: "in_process", label: "En proceso" },
  { value: "completed", label: "Finalizado" },
];

const paymentFilterOptions: Array<FilterOption<PaymentFilter>> = [
  { value: "all", label: "Todos" },
  { value: "pending", label: "Pendiente" },
  { value: "confirmed", label: "Confirmado" },
  { value: "cancelled", label: "Cancelado" },
  { value: "refunded", label: "Reintegrado" },
  { value: "charged_back", label: "Contracargo" },
];

const shippingFilterOptions: Array<FilterOption<ShippingFilter>> = [
  { value: "all", label: "Todos" },
  { value: "in_process", label: "En proceso" },
  { value: "completed", label: "Finalizado" },
];

const sortByOptions: Array<FilterOption<SortByOption>> = [
  { value: "date-desc", label: "Fecha (más reciente)" },
  { value: "date-asc", label: "Fecha (más antigua)" },
  { value: "total-desc", label: "Monto (mayor)" },
  { value: "total-asc", label: "Monto (menor)" },
  { value: "customer-asc", label: "Cliente (A-Z)" },
  { value: "customer-desc", label: "Cliente (Z-A)" },
];

const quickFilterLabels: Record<QuickFilter, string> = {
  all: "Todas",
  "needs-payment": "A cobrar",
  "needs-shipping": "A preparar",
  completed: "Completadas",
};

const actionToneClass = {
  payment: "border-amber-300/70 bg-amber-100 text-amber-900",
  shipping: "border-sky-300/70 bg-sky-100 text-sky-900",
  review: "border-rose-300/70 bg-rose-100 text-rose-900",
  done: "border-emerald-300/70 bg-emerald-100 text-emerald-900",
} as const;

function FilterDropdown<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: Array<FilterOption<T>>;
  onChange: (value: T) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (rootRef.current?.contains(event.target as Node)) return;
      setOpen(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  const selectedLabel = options.find((option) => option.value === value)?.label ?? options[0]?.label ?? "";

  return (
    <div
      ref={rootRef}
      className="relative min-w-0 flex flex-col gap-1 text-[11px] font-semibold uppercase tracking-[0.09em] text-[#6b5a78]"
    >
      <span>{label}</span>
      <button
        type="button"
        onClick={() => setOpen((previous) => !previous)}
        className="flex h-9 items-center justify-between rounded-md border border-[#d8cce4] bg-white px-2.5 text-left text-sm font-medium normal-case tracking-normal text-[#2a1644] shadow-[inset_0_1px_0_rgba(255,255,255,0.7)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-gold-300)]"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="truncate">{selectedLabel}</span>
        <span aria-hidden className={`text-xs transition-transform ${open ? "rotate-180" : ""}`}>
          v
        </span>
      </button>

      {open ? (
        <div className="absolute left-0 right-0 top-[calc(100%+0.35rem)] z-[360] overflow-hidden rounded-md border border-[#d8cce4] bg-white shadow-[0_14px_28px_rgba(47,24,77,0.2)]">
          <ul role="listbox" className="max-h-56 overflow-y-auto py-1">
            {options.map((option) => {
              const isSelected = option.value === value;
              return (
                <li key={option.value}>
                  <button
                    type="button"
                    onClick={() => {
                      onChange(option.value);
                      setOpen(false);
                    }}
                    className={`flex w-full items-center px-2.5 py-2 text-left text-sm font-medium normal-case tracking-normal transition ${
                      isSelected
                        ? "bg-[var(--brand-gold-300)] text-[var(--brand-violet-950)]"
                        : "text-[#2a1644] hover:bg-[#f2ecf8]"
                    }`}
                  >
                    {option.label}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

const formatDate = (value: string) => {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return dateFormatter.format(date);
};

const formatDateOnly = (value: string) => {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return dateOnlyFormatter.format(date);
};

const getShortOrderId = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return "#";

  const timeMatch = trimmed.match(/-(\d{6})-/);
  if (timeMatch) return `#${timeMatch[1]}`;

  const compact = trimmed.replace(/[^a-zA-Z0-9]/g, "");
  return `#${compact.slice(-6).toUpperCase() || trimmed.slice(-6)}`;
};

const getOrderAction = (order: AdminOrderSheetRow, draft: OrderDraft) => {
  if (draft.paymentStatus === "pending") {
    return { label: "Falta confirmar pago", tone: "payment" as const };
  }
  if (
    draft.paymentStatus === "cancelled" ||
    draft.paymentStatus === "refunded" ||
    draft.paymentStatus === "charged_back"
  ) {
    return { label: "Revisar venta", tone: "review" as const };
  }
  if (draft.shippingStatus === "in_process") {
    return { label: "Preparar o entregar", tone: "shipping" as const };
  }
  return { label: "Venta finalizada", tone: "done" as const };
};

const getOrderGeneralStatus = (paymentStatus: PaymentStatus, shippingStatus: ShippingStatus) => {
  if (paymentStatus === "confirmed" && shippingStatus === "completed") return "Completada";
  if (paymentStatus === "confirmed" && shippingStatus === "in_process") return "A preparar";
  if (paymentStatus === "pending") return "A cobrar";
  return "Revisar";
};

const toWaLink = (value: string) => {
  const digits = value.replace(/\D/g, "");
  if (!digits) return null;
  return `https://wa.me/${digits}`;
};

const toMailtoLink = (value: string) => {
  const normalized = value.trim();
  if (!normalized || !normalized.includes("@")) return null;
  return `mailto:${normalized}`;
};

const whatsappIcon = (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    aria-hidden
    className="h-4 w-4"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M20 11.5a8.5 8.5 0 0 1-12.5 7.5L4 20l1-3.2A8.5 8.5 0 1 1 20 11.5Z" />
    <path d="M9.6 9.4c.2-.4.4-.4.6-.4h.4c.2 0 .4 0 .5.4l.5 1.3c.1.2 0 .4-.1.6l-.4.5c.1.3.4.7.8 1.1.4.4.8.7 1.1.8l.5-.4c.2-.1.4-.2.6-.1l1.3.5c.4.1.4.3.4.5v.4c0 .2 0 .4-.4.6-.4.2-1.2.3-2.3-.1-1-.4-2-1.1-2.9-2-.9-.9-1.6-1.9-2-2.9-.4-1.1-.3-1.9-.1-2.3Z" />
  </svg>
);

const paymentMethodLabel = (value: AdminOrderSheetRow["paymentMethod"]) => {
  if (value === "cash") return "Efectivo";
  if (value === "transfer") return "Transferencia";
  if (value === "mercadopago") return "Mercado Pago";
  return "No informado";
};

const deliveryMethodLabel = (value: AdminOrderSheetRow["deliveryMethod"]) => {
  if (value === "delivery") return "Envío a domicilio";
  if (value === "pickup") return "Punto de encuentro coordinado";
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
  if (
    value === "pending" ||
    value === "confirmed" ||
    value === "cancelled" ||
    value === "refunded" ||
    value === "charged_back"
  ) {
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
  const skipLeaveGuardRef = useRef(false);
  const allowedFormIdRef = useRef<string | null>(null);
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [editingOrderId, setEditingOrderId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [paymentFilter, setPaymentFilter] = useState<PaymentFilter>("all");
  const [shippingFilter, setShippingFilter] = useState<ShippingFilter>("all");
  const [sortBy, setSortBy] = useState<SortByOption>("date-desc");
  const [isFiltersOpen, setIsFiltersOpen] = useState(false);
  const [draftByOrder, setDraftByOrder] = useState<Record<string, OrderDraft>>(() =>
    buildDraftMap(orders)
  );
  const [saveDialogState, setSaveDialogState] = useState<SaveDialogState>({
    mode: "closed",
  });
  const [leaveDialogState, setLeaveDialogState] = useState<LeaveDialogState>(null);
  const [isSavingBeforeLeave, setIsSavingBeforeLeave] = useState(false);
  const [leaveDialogError, setLeaveDialogError] = useState<string | null>(null);
  const [isPersistingSale, setIsPersistingSale] = useState(false);

  useBodyScrollLock(
    Boolean(
      selectedOrderId ||
        editingOrderId ||
        saveDialogState.mode !== "closed" ||
        leaveDialogState ||
        isPersistingSale
    )
  );

  useEffect(() => {
    setDraftByOrder(buildDraftMap(orders));
  }, [orders]);

  const selectedOrder = useMemo(
    () => orders.find((order) => order.orderId === selectedOrderId) || null,
    [orders, selectedOrderId]
  );

  const editingOrder = useMemo(
    () => orders.find((order) => order.orderId === editingOrderId) || null,
    [orders, editingOrderId]
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

  const getDraftForOrder = (order: AdminOrderSheetRow): OrderDraft =>
    draftByOrder[order.orderId] || {
      paymentStatus: order.paymentStatus,
      shippingStatus: order.shippingStatus,
    };

  const pendingOrderUpdates = useMemo<PendingOrderUpdate[]>(
    () =>
      orders.reduce<PendingOrderUpdate[]>((accumulator, order) => {
        const draft = draftByOrder[order.orderId] || {
          paymentStatus: order.paymentStatus,
          shippingStatus: order.shippingStatus,
        };

        if (hasChanges(order, draft)) {
          accumulator.push({
            orderId: order.orderId,
            paymentStatus: draft.paymentStatus,
            shippingStatus: draft.shippingStatus,
          });
        }
        return accumulator;
      }, []),
    [orders, draftByOrder]
  );
  const hasUnsavedChanges = pendingOrderUpdates.length > 0;

  const editingDraft = useMemo(
    () =>
      editingOrder
        ? draftByOrder[editingOrder.orderId] || {
            paymentStatus: editingOrder.paymentStatus,
            shippingStatus: editingOrder.shippingStatus,
          }
        : null,
    [editingOrder, draftByOrder]
  );

  const selectedOrderWaLink = selectedOrder ? toWaLink(selectedOrder.whatsapp) : null;
  const selectedOrderMailtoLink = selectedOrder ? toMailtoLink(selectedOrder.email) : null;
  const selectedOrderReceiptSent = Boolean(selectedOrder?.receiptEmailSentAt);

  const summaryStats = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayStart = today.getTime();

    return orders.reduce(
      (stats, order) => {
        const isToday = order.createdAtMs >= todayStart;
        const isPendingPayment = order.paymentStatus === "pending";
        const isReadyForShipping =
          order.paymentStatus === "confirmed" && order.shippingStatus === "in_process";
        const isCompleted =
          order.paymentStatus === "confirmed" && order.shippingStatus === "completed";

        return {
          todayCount: stats.todayCount + (isToday ? 1 : 0),
          pendingPaymentCount: stats.pendingPaymentCount + (isPendingPayment ? 1 : 0),
          shippingCount: stats.shippingCount + (isReadyForShipping ? 1 : 0),
          completedCount: stats.completedCount + (isCompleted ? 1 : 0),
          totalSold: stats.totalSold + order.total,
        };
      },
      {
        todayCount: 0,
        pendingPaymentCount: 0,
        shippingCount: 0,
        completedCount: 0,
        totalSold: 0,
      }
    );
  }, [orders]);

  const activeQuickFilter: QuickFilter =
    paymentFilter === "pending" && shippingFilter === "all"
      ? "needs-payment"
      : paymentFilter === "confirmed" && shippingFilter === "in_process"
        ? "needs-shipping"
        : paymentFilter === "confirmed" && shippingFilter === "completed"
          ? "completed"
          : "all";

  const quickFilters = [
    { value: "all" as const, count: orders.length },
    { value: "needs-payment" as const, count: summaryStats.pendingPaymentCount },
    { value: "needs-shipping" as const, count: summaryStats.shippingCount },
    { value: "completed" as const, count: summaryStats.completedCount },
  ];

  const applyQuickFilter = (filter: QuickFilter) => {
    if (filter === "needs-payment") {
      setPaymentFilter("pending");
      setShippingFilter("all");
      return;
    }

    if (filter === "needs-shipping") {
      setPaymentFilter("confirmed");
      setShippingFilter("in_process");
      return;
    }

    if (filter === "completed") {
      setPaymentFilter("confirmed");
      setShippingFilter("completed");
      return;
    }

    setPaymentFilter("all");
    setShippingFilter("all");
  };

  const visibleOrders = useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLowerCase();

    const filtered = orders.filter((order) => {
      if (paymentFilter !== "all" && order.paymentStatus !== paymentFilter) {
        return false;
      }

      if (shippingFilter !== "all" && order.shippingStatus !== shippingFilter) {
        return false;
      }

      if (!normalizedSearch) {
        return true;
      }

      return [order.orderId, order.customerName, order.whatsapp, order.email]
        .map((value) => value.toLowerCase())
        .some((value) => value.includes(normalizedSearch));
    });

    return filtered.sort((left, right) => {
      switch (sortBy) {
        case "date-asc":
          return left.createdAtMs - right.createdAtMs;
        case "date-desc":
          return right.createdAtMs - left.createdAtMs;
        case "total-asc":
          return left.total - right.total;
        case "total-desc":
          return right.total - left.total;
        case "customer-asc":
          return (left.customerName || "").localeCompare(right.customerName || "", "es");
        case "customer-desc":
          return (right.customerName || "").localeCompare(left.customerName || "", "es");
        default:
          return 0;
      }
    });
  }, [orders, paymentFilter, searchTerm, shippingFilter, sortBy]);

  useEffect(() => {
    if (hasUnsavedChanges) return;
    skipLeaveGuardRef.current = false;
    setLeaveDialogState(null);
    setLeaveDialogError(null);
    setIsSavingBeforeLeave(false);
    setIsPersistingSale(false);
  }, [hasUnsavedChanges]);

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (isPersistingSale) return;
      if (!hasUnsavedChanges || skipLeaveGuardRef.current) return;
      event.preventDefault();
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [hasUnsavedChanges, isPersistingSale]);

  useEffect(() => {
    const handleDocumentClick = (event: MouseEvent) => {
      if (isPersistingSale) return;
      if (!hasUnsavedChanges || skipLeaveGuardRef.current) return;
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

      const target = event.target as HTMLElement | null;
      const anchor = target?.closest("a[href]") as HTMLAnchorElement | null;
      if (!anchor) return;
      if (anchor.target && anchor.target !== "_self") return;
      if (anchor.hasAttribute("download")) return;

      const href = anchor.getAttribute("href");
      if (!href || href.startsWith("#") || href.startsWith("javascript:")) return;

      const currentUrl = new URL(window.location.href);
      const nextUrl = new URL(anchor.href, currentUrl.href);
      if (nextUrl.href === currentUrl.href) return;

      event.preventDefault();
      setLeaveDialogError(null);
      setLeaveDialogState({
        action: "navigate",
        targetHref: nextUrl.href,
      });
    };

    document.addEventListener("click", handleDocumentClick, true);
    return () => document.removeEventListener("click", handleDocumentClick, true);
  }, [hasUnsavedChanges, isPersistingSale]);

  useEffect(() => {
    const handleReloadShortcut = (event: KeyboardEvent) => {
      if (isPersistingSale) return;
      if (!hasUnsavedChanges || skipLeaveGuardRef.current) return;

      const key = event.key.toLowerCase();
      const isReloadShortcut =
        event.key === "F5" || ((event.ctrlKey || event.metaKey) && key === "r");

      if (!isReloadShortcut) return;

      event.preventDefault();
      setLeaveDialogError(null);
      setLeaveDialogState({
        action: "reload",
        targetHref: window.location.href,
      });
    };

    window.addEventListener("keydown", handleReloadShortcut);
    return () => window.removeEventListener("keydown", handleReloadShortcut);
  }, [hasUnsavedChanges, isPersistingSale]);

  const continueLeave = (state: LeaveDialogState) => {
    if (!state) return;
    skipLeaveGuardRef.current = true;

    if (state.action === "reload") {
      window.location.reload();
      return;
    }
    window.location.href = state.targetHref;
  };

  const handleDiscardAndLeave = () => {
    if (!leaveDialogState) return;
    continueLeave(leaveDialogState);
  };

  const handleSaveAndLeave = async () => {
    if (!leaveDialogState) return;

    setIsSavingBeforeLeave(true);
    setLeaveDialogError(null);

    try {
      if (pendingOrderUpdates.length > 0) {
        await saveOrderStatusesBatchAction(pendingOrderUpdates);
      }
      continueLeave(leaveDialogState);
    } catch {
      skipLeaveGuardRef.current = false;
      setIsSavingBeforeLeave(false);
      setLeaveDialogError(
        "No pudimos guardar los cambios antes de salir. Probá nuevamente."
      );
    }
  };

  const handleSubmitConfirm = (order: AdminOrderSheetRow, event: FormEvent<HTMLFormElement>) => {
    const formElement = event.currentTarget;
    const formId = formElement.id || `venta-form-${order.orderId}`;

    if (allowedFormIdRef.current === formId) {
      allowedFormIdRef.current = null;
      setIsPersistingSale(true);
      return;
    }

    event.preventDefault();

    const formData = new FormData(formElement);
    const nextPaymentStatus = toPaymentStatus(formData.get("paymentStatus"));
    const nextShippingStatus = toShippingStatus(formData.get("shippingStatus"));

    if (!nextPaymentStatus || !nextShippingStatus) {
      setSaveDialogState({
        mode: "info",
        title: "Estado inválido",
        description: "Revisá los estados antes de guardar.",
      });
      return;
    }

    const changed =
      order.paymentStatus !== nextPaymentStatus ||
      order.shippingStatus !== nextShippingStatus;

    if (!changed) {
      setSaveDialogState({
        mode: "info",
        title: "Sin cambios",
        description: "No hay cambios para guardar en esta venta.",
      });
      return;
    }

    const confirmingPayment =
      order.paymentStatus !== "confirmed" && nextPaymentStatus === "confirmed";
    const warning = confirmingPayment
      ? "Esto marcará el pago como Confirmado y enviará el email de comprobante. "
      : "";
    setSaveDialogState({
      mode: "confirm",
      title: "Confirmar guardado",
      description: `${warning}Se actualizarán los estados de la venta ${order.orderId}.`,
      orderId: order.orderId,
      formId,
    });
  };

  const handleConfirmSave = () => {
    if (saveDialogState.mode !== "confirm") return;

    const nextFormId = saveDialogState.formId;
    setSaveDialogState({ mode: "closed" });
    skipLeaveGuardRef.current = true;
    allowedFormIdRef.current = nextFormId;
    setIsPersistingSale(true);

    const formElement = document.getElementById(nextFormId);
    if (formElement instanceof HTMLFormElement) {
      formElement.requestSubmit();
      return;
    }
    skipLeaveGuardRef.current = false;
    allowedFormIdRef.current = null;
    setIsPersistingSale(false);
  };

  const persistPendingChanges = async () => {
    setIsPersistingSale(true);
    skipLeaveGuardRef.current = true;

    try {
      await saveOrderStatusesBatchAction(pendingOrderUpdates);
      window.location.reload();
    } catch {
      skipLeaveGuardRef.current = false;
      setIsPersistingSale(false);
      setSaveDialogState({
        mode: "info",
        title: "No pudimos guardar",
        description: "Los cambios siguen pendientes. Revisá tu conexión y probá nuevamente.",
      });
    }
  };

  const handleSavePendingChanges = () => {
    if (pendingOrderUpdates.length === 0 || isPersistingSale) return;

    const confirmsPayment = pendingOrderUpdates.some((update) => {
      const order = orders.find((entry) => entry.orderId === update.orderId);
      return order?.paymentStatus !== "confirmed" && update.paymentStatus === "confirmed";
    });

    if (confirmsPayment) {
      setSaveDialogState({
        mode: "batchConfirm",
        title: "Confirmar cambios",
        description:
          "Al menos una venta pasará a pago Confirmado y puede enviar el email de comprobante. Revisá que esté todo correcto antes de guardar.",
      });
      return;
    }

    void persistPendingChanges();
  };

  const handleConfirmBatchSave = () => {
    if (saveDialogState.mode !== "batchConfirm") return;
    setSaveDialogState({ mode: "closed" });
    void persistPendingChanges();
  };

  return (
    <>
      {hasUnsavedChanges ? (
        <div className="mb-3 flex flex-col gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-amber-950 shadow-[0_10px_22px_rgba(45,22,75,0.12)] sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-bold">
              {pendingOrderUpdates.length} cambio{pendingOrderUpdates.length === 1 ? "" : "s"} pendiente
              {pendingOrderUpdates.length === 1 ? "" : "s"}
            </p>
            <p className="text-xs text-amber-900/80">Guardalos antes de salir o cambiar de sección.</p>
          </div>
          <button
            type="button"
            onClick={handleSavePendingChanges}
            disabled={isPersistingSale}
            className="rounded-md bg-[var(--brand-gold-300)] px-3 py-2 text-xs font-bold text-[var(--brand-violet-950)] transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Guardar cambios
          </button>
        </div>
      ) : null}

      <div className="mb-2">
        <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
          {quickFilters.map((filter) => {
            const isActive = activeQuickFilter === filter.value;
            return (
              <button
                key={filter.value}
                type="button"
                onClick={() => applyQuickFilter(filter.value)}
                aria-pressed={isActive}
                className={`flex min-w-0 items-center justify-between gap-2 rounded-full border px-2.5 py-1.5 text-xs font-bold transition sm:min-w-[8.5rem] ${
                  isActive
                    ? "border-[var(--brand-gold-300)] bg-[var(--brand-gold-300)] text-[var(--brand-violet-950)] shadow-[0_8px_18px_rgba(45,22,75,0.18)]"
                    : "border-white/30 bg-white/16 text-[var(--brand-cream)] hover:bg-white/24"
                }`}
              >
                <span className="truncate">{quickFilterLabels[filter.value]}</span>
                <span
                  className={`inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full px-1 text-[10px] ${
                    isActive ? "bg-white/55" : "bg-white/16"
                  }`}
                >
                  {filter.count}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <section className="relative z-[80] mb-3 rounded-lg border border-[#e4d8ec] bg-[#fbf8ff] p-2.5 text-[#2a1644] shadow-[0_10px_20px_rgba(45,22,75,0.14)] sm:p-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-[#715889]">
              Filtros
            </p>
            <p className="mt-0.5 text-xs font-medium text-[#725f80]">
              <span className="md:hidden">{visibleOrders.length} ventas</span>
              <span className="hidden md:inline">
                Mostrando {visibleOrders.length} de {orders.length} ventas
              </span>
            </p>
          </div>
          <button
            type="button"
            onClick={() => setIsFiltersOpen((previous) => !previous)}
            aria-expanded={isFiltersOpen}
            aria-controls="ventas-filter-panel"
            className="rounded-md border border-[#d8cce4] bg-white px-3 py-1.5 text-xs font-bold text-[#2a1644] shadow-sm md:hidden"
          >
            {isFiltersOpen ? "Ocultar" : "Filtros"}
          </button>
        </div>

        <div
          id="ventas-filter-panel"
          className={`${isFiltersOpen ? "grid" : "hidden"} mt-3 grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4 md:grid`}
        >
          <FilterDropdown
            label="Estado pago"
            value={paymentFilter}
            options={paymentFilterOptions}
            onChange={setPaymentFilter}
          />

          <FilterDropdown
            label="Estado envío"
            value={shippingFilter}
            options={shippingFilterOptions}
            onChange={setShippingFilter}
          />

          <FilterDropdown label="Ordenar" value={sortBy} options={sortByOptions} onChange={setSortBy} />

          <label className="min-w-0 flex flex-col gap-1 text-[11px] font-semibold uppercase tracking-[0.09em] text-[#6b5a78]">
            Buscar
            <input
              type="text"
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="Cliente, ID, WhatsApp, email"
              className="h-9 rounded-md border border-[#d8cce4] bg-white px-2.5 text-sm font-medium normal-case tracking-normal text-[#2a1644] placeholder:text-[#725f80]/58 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-gold-300)]"
            />
          </label>
        </div>

        <div className={`${isFiltersOpen ? "flex" : "hidden"} mt-3 items-center justify-between gap-2 md:flex`}>
          <p className="text-xs font-medium text-[#725f80]">
            <span className="hidden md:inline">Mostrando {visibleOrders.length} de {orders.length} ventas · </span>
            Orden actual: {sortByOptions.find((option) => option.value === sortBy)?.label}
          </p>
          <button
            type="button"
            onClick={() => {
              setSearchTerm("");
              setPaymentFilter("all");
              setShippingFilter("all");
              setSortBy("date-desc");
            }}
            className="rounded-full border border-[#d8cce4] bg-white px-3 py-1 text-[11px] font-bold uppercase tracking-[0.08em] text-[#2a1644] transition hover:bg-[#f2ecf8]"
          >
            Limpiar
          </button>
        </div>
      </section>

      <div className="space-y-3 md:hidden">
        {visibleOrders.length === 0 ? (
          <p className="rounded-lg border border-dashed border-white/35 bg-white/12 px-4 py-6 text-center text-sm text-[var(--brand-cream)]/85">
            No hay ventas que cumplan con los filtros seleccionados.
          </p>
        ) : (
          visibleOrders.map((order) => {
          const draft = getDraftForOrder(order);
          const waLink = toWaLink(order.whatsapp);

          return (
            <article
              key={order.orderId}
              className="rounded-lg border border-[#e4d8ec] bg-[#fbf8ff] p-3 text-[#2a1644] shadow-[0_12px_24px_rgba(45,22,75,0.16)]"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs font-black uppercase tracking-[0.08em] text-[#715889]">
                    {getShortOrderId(order.orderId)}
                  </p>
                  <p className="mt-2 text-sm font-bold uppercase leading-tight tracking-[0.02em]">
                    {order.customerName || "-"}
                  </p>
                  <p className="mt-0.5 text-xs font-medium text-[#725f80]">{formatDateOnly(order.createdAt)}</p>
                </div>
                <p className="shrink-0 whitespace-nowrap text-right text-base font-black tabular-nums text-[var(--brand-violet-950)]">
                  {formatMoney(order.total)}
                </p>
              </div>

              <p className="mt-3 text-xs font-semibold leading-relaxed text-[#5d466f]">
                Pago {paymentStatusLabel[draft.paymentStatus].toLowerCase()} · Envío{" "}
                {shippingStatusLabel[draft.shippingStatus].toLowerCase()}
              </p>

              <div className="mt-3 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setSelectedOrderId(order.orderId)}
                  className="rounded-md border border-[#d8cce4] bg-white px-2.5 py-2 text-xs font-bold text-[#2a1644] transition hover:bg-[#f2ecf8]"
                >
                  Detalle
                </button>
                {waLink ? (
                  <a
                    href={waLink}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center justify-center gap-1 rounded-md border border-emerald-300/70 bg-emerald-500 px-2.5 py-2 text-xs font-bold text-white transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-200/70"
                  >
                    {whatsappIcon}
                    WhatsApp
                  </a>
                ) : (
                  <span
                    className="inline-flex items-center justify-center gap-1 rounded-md border border-[#d8cce4] bg-[#f2ecf8] px-2.5 py-2 text-xs font-bold text-[#725f80]/55"
                    aria-hidden
                  >
                    {whatsappIcon}
                    WhatsApp
                  </span>
                )}
              </div>
            </article>
          );
          })
        )}
      </div>

      <div className="relative z-0 hidden overflow-x-auto rounded-lg border border-[#e4d8ec] bg-white shadow-[0_16px_30px_rgba(12,6,24,0.22)] md:block">
        <table className="min-w-[1180px] w-full table-fixed text-left">
          <thead className="bg-[#efe7f6] text-[#4f356c]">
            <tr className="text-center text-xs uppercase tracking-[0.1em]">
              <th className="w-[13%] px-3 py-3">Pedido</th>
              <th className="w-[9%] px-3 py-3">Fecha</th>
              <th className="w-[15%] px-3 py-3">Cliente</th>
              <th className="w-[15%] px-3 py-3">Próxima acción</th>
              <th className="w-[9%] px-3 py-3">Total</th>
              <th className="w-[14%] px-3 py-3">Estado Pago</th>
              <th className="w-[14%] px-3 py-3">Estado Envío</th>
              <th className="w-[8%] px-3 py-3">Contacto</th>
              <th className="w-[13%] px-3 py-3">Gestión</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#eadff2] bg-white text-[13px] text-[#2a1644]">
            {visibleOrders.length === 0 ? (
              <tr>
                <td
                  colSpan={9}
                  className="px-4 py-8 text-center text-sm font-medium text-[var(--brand-violet-900)]/75"
                >
                  No hay ventas que cumplan con los filtros seleccionados.
                </td>
              </tr>
            ) : (
              visibleOrders.map((order) => {
              const waLink = toWaLink(order.whatsapp);
              const formId = `venta-form-${order.orderId}`;
              const draft = getDraftForOrder(order);
              const rowHasChanges = hasChanges(order, draft);
              const action = getOrderAction(order, draft);

              return (
                <tr
                  key={order.orderId}
                  className="align-middle transition-colors odd:bg-white even:bg-[rgba(92,54,150,0.04)] hover:bg-[rgba(92,54,150,0.09)]"
                >
                  <td className="px-3 py-3.5">
                    <span
                      className="block max-w-full truncate font-bold text-[var(--brand-violet-950)]"
                      title={order.orderId}
                    >
                      {getShortOrderId(order.orderId)}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-3 py-3.5 text-center text-[13px] font-medium tabular-nums text-[var(--brand-violet-900)]/95">
                    {formatDate(order.createdAt)}
                  </td>
                  <td className="px-3 py-3.5">
                    <span
                      className="inline-block max-w-full truncate text-[var(--brand-violet-950)] font-bold uppercase tracking-[0.02em]"
                      title={order.customerName || "-"}
                    >
                      {order.customerName || "-"}
                    </span>
                  </td>
                  <td className="px-3 py-3.5 text-center">
                    <span className={`inline-flex max-w-full items-center justify-center rounded-full border px-2 py-1 text-[11px] font-bold ${actionToneClass[action.tone]}`}>
                      <span className="truncate">{action.label}</span>
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-3 py-3.5 text-center font-bold tabular-nums text-[var(--brand-violet-950)]">
                    {formatMoney(order.total)}
                  </td>
                  <td className="px-3 py-3.5 text-center">
                    <div className="relative mx-auto w-[124px]">
                      <select
                        form={formId}
                        name="paymentStatus"
                        value={draft.paymentStatus}
                        onChange={(event) =>
                          updateDraft(order.orderId, {
                            paymentStatus: event.target.value as PaymentStatus,
                          })
                        }
                        className={`block h-8 w-full appearance-none rounded-lg border px-2 pr-6 text-xs font-semibold shadow-[inset_0_1px_0_rgba(255,255,255,0.32)] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-gold-300)] ${paymentBadgeClass[draft.paymentStatus]}`}
                      >
                        <option value="pending" className={paymentOptionClass.pending}>
                          Pendiente
                        </option>
                        <option value="confirmed" className={paymentOptionClass.confirmed}>
                          Confirmado
                        </option>
                        <option value="cancelled" className={paymentOptionClass.cancelled}>
                          Cancelado
                        </option>
                        <option value="refunded" className={paymentOptionClass.refunded}>
                          Reintegrado
                        </option>
                        <option value="charged_back" className={paymentOptionClass.charged_back}>
                          Contracargo
                        </option>
                      </select>
                      <span
                        className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-[11px] text-[var(--brand-violet-950)]/70"
                        aria-hidden
                      >
                        ▾
                      </span>
                    </div>
                  </td>
                  <td className="px-3 py-3.5 text-center">
                    <div className="relative mx-auto w-[124px]">
                      <select
                        form={formId}
                        name="shippingStatus"
                        value={draft.shippingStatus}
                        onChange={(event) =>
                          updateDraft(order.orderId, {
                            shippingStatus: event.target.value as ShippingStatus,
                          })
                        }
                        className={`block h-8 w-full appearance-none rounded-lg border px-2 pr-6 text-xs font-semibold shadow-[inset_0_1px_0_rgba(255,255,255,0.32)] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-gold-300)] ${shippingBadgeClass[draft.shippingStatus]}`}
                      >
                        <option value="in_process" className={shippingOptionClass.in_process}>
                          En proceso
                        </option>
                        <option value="completed" className={shippingOptionClass.completed}>
                          Finalizado
                        </option>
                      </select>
                      <span
                        className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-[11px] text-[var(--brand-violet-950)]/70"
                        aria-hidden
                      >
                        ▾
                      </span>
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-3 py-3.5 text-center">
                    {waLink ? (
                      <a
                        href={waLink}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center justify-center rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs font-bold text-emerald-800 transition hover:bg-emerald-100"
                      >
                        WhatsApp
                      </a>
                    ) : (
                      <span className="text-[#725f80]/55">-</span>
                    )}
                  </td>
                  <td className="px-3 py-3.5 text-center">
                    <div className="flex items-center justify-center gap-2">
                      <form
                        id={formId}
                        action={updateOrderStatusesAction}
                        onSubmit={(event) => handleSubmitConfirm(order, event)}
                      >
                        <input type="hidden" name="orderId" value={order.orderId} />
                        <input type="hidden" name="redirectTo" value="/admin/ventas" />
                        {rowHasChanges ? (
                          <button
                            type="submit"
                            disabled={isPersistingSale}
                            className="whitespace-nowrap rounded-md bg-[var(--brand-gold-300)] px-2.5 py-1.5 text-xs font-bold text-[var(--brand-violet-950)] transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            Guardar
                          </button>
                        ) : null}
                      </form>
                      <button
                        type="button"
                        onClick={() => setSelectedOrderId(order.orderId)}
                        className="whitespace-nowrap rounded-md border border-[#d8cce4] bg-white px-2.5 py-1.5 text-xs font-bold text-[var(--brand-violet-950)] transition hover:bg-[#f2ecf8]"
                      >
                        Detalle
                      </button>
                    </div>
                  </td>
                </tr>
              );
              })
            )}
          </tbody>
        </table>
      </div>

      {editingOrder && (
        <div className="fixed inset-0 z-[210] flex items-end bg-[rgba(10,5,20,0.7)] md:hidden">
          <div className="w-full overflow-hidden rounded-t-3xl border border-[var(--brand-gold-300)]/30 bg-[var(--brand-violet-950)] p-4 text-[var(--brand-cream)] shadow-[0_-18px_46px_rgba(4,2,10,0.55)]">
            <div className="mb-3 flex items-start justify-between gap-4">
              <div>
                <p className="text-[10px] uppercase tracking-[0.12em] text-[var(--brand-gold-300)]/85">
                  Editar estado
                </p>
                <p className="mt-1 truncate whitespace-nowrap text-sm font-semibold">{editingOrder.orderId}</p>
              </div>
              <button
                type="button"
                onClick={() => setEditingOrderId(null)}
                className="rounded-full border border-[var(--brand-gold-300)]/40 p-2 text-[var(--brand-cream)] transition hover:bg-white/10"
                aria-label="Cerrar edicion de estado"
              >
                X
              </button>
            </div>

            <form
              id={`venta-form-mobile-${editingOrder.orderId}`}
              action={updateOrderStatusesAction}
              onSubmit={(event) => handleSubmitConfirm(editingOrder, event)}
              className="space-y-3"
            >
              <input type="hidden" name="orderId" value={editingOrder.orderId} />
              <input type="hidden" name="redirectTo" value="/admin/ventas" />

              <fieldset className="space-y-1.5">
                <legend className="text-xs font-medium text-[var(--brand-cream)]/85">Estado pago</legend>
                <input
                  type="hidden"
                  name="paymentStatus"
                  value={editingDraft?.paymentStatus ?? editingOrder.paymentStatus}
                />
                <div className="grid grid-cols-3 gap-1.5">
                  {paymentStatusOptions.map((option) => {
                    const isActive =
                      (editingDraft?.paymentStatus ?? editingOrder.paymentStatus) === option.value;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() =>
                          updateDraft(editingOrder.orderId, {
                            paymentStatus: option.value,
                          })
                        }
                        className={`rounded-lg border px-2 py-2 text-xs font-semibold transition ${
                          isActive
                            ? paymentStatusButtonClass[option.value]
                            : "border-[var(--brand-gold-300)]/35 bg-white/8 text-[var(--brand-cream)] hover:bg-white/12"
                        }`}
                      >
                        {option.label}
                      </button>
                    );
                  })}
                </div>
              </fieldset>

              <fieldset className="space-y-1.5">
                <legend className="text-xs font-medium text-[var(--brand-cream)]/85">Estado envío</legend>
                <input
                  type="hidden"
                  name="shippingStatus"
                  value={editingDraft?.shippingStatus ?? editingOrder.shippingStatus}
                />
                <div className="grid grid-cols-2 gap-1.5">
                  {shippingStatusOptions.map((option) => {
                    const isActive =
                      (editingDraft?.shippingStatus ?? editingOrder.shippingStatus) === option.value;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() =>
                          updateDraft(editingOrder.orderId, {
                            shippingStatus: option.value,
                          })
                        }
                        className={`rounded-lg border px-2 py-2 text-xs font-semibold transition ${
                          isActive
                            ? shippingStatusButtonClass[option.value]
                            : "border-[var(--brand-gold-300)]/35 bg-white/8 text-[var(--brand-cream)] hover:bg-white/12"
                        }`}
                      >
                        {option.label}
                      </button>
                    );
                  })}
                </div>
              </fieldset>

              <div className="grid grid-cols-2 gap-2 pt-1">
                <button
                  type="submit"
                  disabled={
                    !hasChanges(editingOrder, editingDraft ?? getDraftForOrder(editingOrder)) ||
                    isPersistingSale
                  }
                  className="rounded-lg bg-[var(--brand-gold-300)] px-2.5 py-2 text-xs font-semibold text-[var(--brand-violet-950)] transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-55"
                >
                  Guardar cambios
                </button>
                <button
                  type="button"
                  onClick={() => setEditingOrderId(null)}
                  className="rounded-lg border border-[var(--brand-gold-300)]/40 px-2.5 py-2 text-xs font-semibold text-[var(--brand-cream)] transition hover:bg-white/10"
                >
                  Cancelar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {saveDialogState.mode !== "closed" && (
        <div className="fixed inset-0 z-[300] flex items-center justify-center bg-[rgba(10,5,20,0.68)] p-4">
          <div className="w-full max-w-md rounded-2xl border border-[var(--brand-gold-300)]/35 bg-[var(--brand-violet-950)] p-5 text-[var(--brand-cream)] shadow-[0_22px_46px_rgba(4,2,10,0.55)]">
            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--brand-gold-300)]/85">
              Estado de venta
            </p>
            <h3 className="mt-2 [font-family:var(--font-brand-display)] text-2xl">
              {saveDialogState.title}
            </h3>
            <p className="mt-2 text-sm text-[var(--brand-cream)]/85">
              {saveDialogState.description}
            </p>

            {saveDialogState.mode === "confirm" || saveDialogState.mode === "batchConfirm" ? (
              <div className="mt-5 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setSaveDialogState({ mode: "closed" })}
                  disabled={isPersistingSale}
                  className="rounded-lg border border-[var(--brand-gold-300)]/40 px-3 py-2 text-xs font-semibold text-[var(--brand-cream)] transition hover:bg-white/10"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={
                    saveDialogState.mode === "batchConfirm"
                      ? handleConfirmBatchSave
                      : handleConfirmSave
                  }
                  disabled={isPersistingSale}
                  className="rounded-lg bg-[var(--brand-gold-300)] px-3 py-2 text-xs font-semibold text-[var(--brand-violet-950)] transition hover:brightness-105"
                >
                  Guardar
                </button>
              </div>
            ) : (
              <div className="mt-5">
                <button
                  type="button"
                  onClick={() => setSaveDialogState({ mode: "closed" })}
                  className="w-full rounded-lg bg-[var(--brand-gold-300)] px-3 py-2 text-xs font-semibold text-[var(--brand-violet-950)] transition hover:brightness-105"
                >
                  Entendido
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {leaveDialogState && (
        <div className="fixed inset-0 z-[320] flex items-center justify-center bg-[rgba(10,5,20,0.72)] p-4">
          <div className="w-full max-w-xl rounded-2xl border border-[var(--brand-gold-300)]/35 bg-[var(--brand-violet-950)] p-5 text-[var(--brand-cream)] shadow-[0_22px_46px_rgba(4,2,10,0.55)]">
            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--brand-gold-300)]/85">
              Cambios sin guardar
            </p>
            <h3 className="mt-2 [font-family:var(--font-brand-display)] text-2xl">
              ¿Querés salir de Ventas?
            </h3>
            <p className="mt-2 text-sm text-[var(--brand-cream)]/85">
              Tenés {pendingOrderUpdates.length} venta{pendingOrderUpdates.length === 1 ? "" : "s"} con
              cambios pendientes. Podés descartarlos o guardarlos antes de salir.
            </p>
            {leaveDialogError ? (
              <p className="mt-3 rounded-lg border border-rose-300/35 bg-rose-950/35 px-3 py-2 text-sm text-rose-100">
                {leaveDialogError}
              </p>
            ) : null}

            <div className="mt-5 grid grid-cols-1 gap-2 sm:grid-cols-3">
              <button
                type="button"
                onClick={() => setLeaveDialogState(null)}
                disabled={isSavingBeforeLeave}
                className="rounded-lg border border-[var(--brand-gold-300)]/40 px-3 py-2 text-xs font-semibold text-[var(--brand-cream)] transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleDiscardAndLeave}
                disabled={isSavingBeforeLeave}
                className="rounded-lg border border-rose-300/45 bg-rose-100/12 px-3 py-2 text-xs font-semibold text-rose-100 transition hover:bg-rose-100/20 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Descartar y salir
              </button>
              <button
                type="button"
                onClick={handleSaveAndLeave}
                disabled={isSavingBeforeLeave}
                className="rounded-lg bg-[var(--brand-gold-300)] px-3 py-2 text-xs font-semibold text-[var(--brand-violet-950)] transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-65"
              >
                {isSavingBeforeLeave ? "Guardando..." : "Guardar y salir"}
              </button>
            </div>
          </div>
        </div>
      )}

      {isPersistingSale && (
        <div className="fixed inset-0 z-[340] flex items-center justify-center bg-[rgba(10,5,20,0.74)] p-4">
          <div className="w-full max-w-sm rounded-2xl border border-[var(--brand-gold-300)]/35 bg-[var(--brand-violet-950)] p-5 text-center text-[var(--brand-cream)] shadow-[0_22px_46px_rgba(4,2,10,0.55)]">
            <span
              className="mx-auto inline-flex h-10 w-10 animate-spin items-center justify-center rounded-full border-2 border-[var(--brand-gold-300)]/40 border-t-[var(--brand-gold-300)]"
              aria-hidden
            />
            <p className="mt-3 [font-family:var(--font-brand-display)] text-2xl">Guardando venta</p>
            <p className="mt-1 text-sm text-[var(--brand-cream)]/82">
              Estamos aplicando los cambios.
            </p>
          </div>
        </div>
      )}

      {selectedOrder && (
        <div className="fixed inset-0 z-[200] flex items-end justify-center bg-[rgba(10,5,20,0.72)] p-0 md:items-center md:p-4">
          <div className="flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-3xl border border-[var(--brand-gold-300)]/35 bg-[var(--brand-violet-950)] text-[var(--brand-cream)] shadow-[0_-18px_46px_rgba(4,2,10,0.55)] md:max-h-[88vh] md:max-w-[640px] md:rounded-3xl md:shadow-[0_24px_52px_rgba(4,2,10,0.55)]">
            <div className="border-b border-[var(--brand-gold-300)]/20 px-4 pb-3 pt-4 md:px-5 md:pb-4 md:pt-5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--brand-gold-300)]/90">
                    Detalle de venta
                  </p>
                  <h3 className="mt-1 [font-family:var(--font-brand-display)] text-2xl leading-tight text-white md:text-3xl">
                    Pedido {getShortOrderId(selectedOrder.orderId)}
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedOrderId(null)}
                  className="shrink-0 rounded-full border border-[var(--brand-gold-300)]/45 px-3 py-2 text-xs font-bold text-[var(--brand-cream)] transition hover:bg-white/10"
                  aria-label="Cerrar detalle"
                >
                  Cerrar
                </button>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-[var(--brand-gold-300)] px-3 py-1 text-sm font-bold text-[var(--brand-violet-950)]">
                  {formatMoney(selectedOrder.total)}
                </span>
                <span className="rounded-full border border-emerald-200/70 bg-emerald-100 px-3 py-1 text-xs font-bold text-emerald-900">
                  {getOrderGeneralStatus(selectedOrder.paymentStatus, selectedOrder.shippingStatus)}
                </span>
              </div>
            </div>

            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4 md:px-5">
              <section className="rounded-2xl border border-[#e2d7ea] bg-[#fbf8ff] p-3 text-[#2a1644] md:p-4">
                <dl className="grid grid-cols-2 gap-3 text-sm">
                  <div className="min-w-0">
                    <dt className="text-[10px] font-bold uppercase tracking-[0.1em] text-[#7a6988]">Cliente</dt>
                    <dd className="mt-1 break-words font-bold">{selectedOrder.customerName || "-"}</dd>
                  </div>
                  <div>
                    <dt className="text-[10px] font-bold uppercase tracking-[0.1em] text-[#7a6988]">Fecha</dt>
                    <dd className="mt-1 font-bold">{formatDate(selectedOrder.createdAt)}</dd>
                  </div>
                  <div>
                    <dt className="text-[10px] font-bold uppercase tracking-[0.1em] text-[#7a6988]">Total</dt>
                    <dd className="mt-1 whitespace-nowrap font-bold">{formatMoney(selectedOrder.total)}</dd>
                  </div>
                  <div>
                    <dt className="text-[10px] font-bold uppercase tracking-[0.1em] text-[#7a6988]">
                      Estado general
                    </dt>
                    <dd className="mt-1 font-bold">
                      {getOrderGeneralStatus(selectedOrder.paymentStatus, selectedOrder.shippingStatus)}
                    </dd>
                  </div>
                </dl>
                <p className="mt-3 rounded-xl bg-white px-3 py-2 text-xs font-semibold text-[#5a4867]">
                  Pago {paymentStatusLabel[selectedOrder.paymentStatus].toLowerCase()} · Envío{" "}
                  {shippingStatusLabel[selectedOrder.shippingStatus].toLowerCase()}
                </p>
                <div className="mt-2 grid gap-2 text-xs text-[#5a4867] sm:grid-cols-2">
                  <p className="rounded-xl bg-white px-3 py-2">
                    <span className="font-bold">Forma de pago:</span>{" "}
                    {paymentMethodLabel(selectedOrder.paymentMethod)}
                  </p>
                  <p className="rounded-xl bg-white px-3 py-2">
                    <span className="font-bold">Entrega:</span>{" "}
                    {deliveryMethodLabel(selectedOrder.deliveryMethod)}
                  </p>
                </div>
              </section>

              <section className="grid gap-2 rounded-2xl border border-[var(--brand-gold-300)]/20 bg-white/8 p-3 text-sm md:grid-cols-2 md:p-4">
                <div className="min-w-0 rounded-xl bg-white/8 px-3 py-2">
                  <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-[var(--brand-cream)]/65">
                    WhatsApp
                  </p>
                  <div className="mt-1 flex items-center justify-between gap-2">
                    <span className="min-w-0 truncate font-semibold text-white">
                      {selectedOrder.whatsapp || "-"}
                    </span>
                    {selectedOrderWaLink ? (
                      <a
                        href={selectedOrderWaLink}
                        target="_blank"
                        rel="noreferrer"
                        className="shrink-0 rounded-lg bg-emerald-100 px-3 py-1.5 text-xs font-bold text-emerald-900 transition hover:bg-emerald-200"
                      >
                        Abrir
                      </a>
                    ) : null}
                  </div>
                </div>
                <div className="min-w-0 rounded-xl bg-white/8 px-3 py-2">
                  <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-[var(--brand-cream)]/65">
                    Email
                  </p>
                  <div className="mt-1 flex items-center justify-between gap-2">
                    <span className="min-w-0 truncate font-semibold text-white" title={selectedOrder.email}>
                      {selectedOrder.email || "-"}
                    </span>
                    {selectedOrderMailtoLink ? (
                      <a
                        href={selectedOrderMailtoLink}
                        className="shrink-0 rounded-lg border border-[var(--brand-gold-300)]/45 px-3 py-1.5 text-xs font-bold text-[var(--brand-cream)] transition hover:bg-white/10"
                      >
                        Abrir
                      </a>
                    ) : null}
                  </div>
                </div>
                <div className="min-w-0 rounded-xl bg-white/8 px-3 py-2 md:col-span-2">
                  <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-[var(--brand-cream)]/65">
                    Comprobante enviado
                  </p>
                  <p
                    className={`mt-1 text-sm font-semibold ${
                      selectedOrderReceiptSent ? "text-emerald-200" : "text-[var(--brand-cream)]/88"
                    }`}
                  >
                    {selectedOrderReceiptSent ? "Enviado" : "Pendiente"}
                    {selectedOrderReceiptSent && selectedOrder.receiptEmailSentAt ? (
                      <span className="font-normal text-[var(--brand-cream)]/70">
                        {" "}
                        · {formatDate(selectedOrder.receiptEmailSentAt)}
                      </span>
                    ) : null}
                  </p>
                </div>
              </section>

              <section className="rounded-2xl border border-[#e2d7ea] bg-[#fbf8ff] p-3 text-[#2a1644] md:p-4">
                <h4 className="text-xs font-bold uppercase tracking-[0.12em] text-[#6b4a82]">Items comprados</h4>
                {selectedOrder.items.length > 0 ? (
                  <ul className="mt-3 divide-y divide-[#e6ddec] text-sm">
                    {selectedOrder.items.map((item, index) => (
                      <li key={`${item.title}-${index}`} className="flex items-start justify-between gap-3 py-2 first:pt-0 last:pb-0">
                        <span className="min-w-0 break-words font-semibold leading-snug">
                          <span className="mr-1 rounded-md bg-[#efe7f6] px-1.5 py-0.5 text-xs font-bold text-[#6b4a82]">
                            {item.qty}x
                          </span>
                          {item.title}
                        </span>
                        <span className="shrink-0 whitespace-nowrap text-xs font-bold text-[#6b4a82]">
                          {typeof item.unitPrice === "number" ? formatMoney(item.unitPrice) : ""}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : selectedOrder.itemsSummary ? (
                  <p className="mt-2 break-words text-sm font-medium text-[#3d2852]">{selectedOrder.itemsSummary}</p>
                ) : (
                  <p className="mt-2 text-sm text-[#725f80]">No hay detalle de items disponible.</p>
                )}
              </section>

              {selectedOrder.notes ? (
                <section className="rounded-2xl border border-[var(--brand-gold-300)]/20 bg-white/8 p-3 md:p-4">
                  <h4 className="text-xs font-bold uppercase tracking-[0.12em] text-[var(--brand-gold-300)]">
                    Notas
                  </h4>
                  <p className="mt-1 break-words text-sm text-[var(--brand-cream)]/90">{selectedOrder.notes}</p>
                </section>
              ) : (
                <p className="px-1 text-xs text-[var(--brand-cream)]/65">Notas: sin notas</p>
              )}

              <p className="break-all px-1 text-[11px] text-[var(--brand-cream)]/55" title={selectedOrder.orderId}>
                ID interno: {selectedOrder.orderId}
              </p>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

