import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { AdminOrderSheetRow } from "@/src/server/sheets/repository";

vi.mock("@/app/admin/actions", () => ({
  retryOrderInventoryAction: vi.fn(),
  saveOrderStatusesBatchAction: vi.fn(),
}));

import { AdminFulfillmentDetails } from "@/app/admin/ventas/VentasTable";

const makeOrder = (patch: Partial<AdminOrderSheetRow> = {}): AdminOrderSheetRow => ({
  orderId: "order-admin-ui",
  createdAt: "2026-08-30T12:00:00.000Z",
  createdAtMs: Date.parse("2026-08-30T12:00:00.000Z"),
  customerName: "Ana Pérez",
  whatsapp: "3415550000",
  email: "ana@example.com",
  total: 22000,
  currency: "ARS",
  paymentStatus: "confirmed",
  shippingStatus: "in_process",
  paymentMethod: "transfer",
  deliveryMethod: "delivery",
  items: [],
  itemsSummary: "",
  notes: "",
  inventoryIssueCode: "",
  inventoryIssueAt: "",
  stockDeductedAt: "",
  receiptEmailSentAt: "",
  raw: {},
  ...patch,
});

describe("AUD3 H07-E2 Admin fulfillment details", () => {
  it("EF-E-02-04 renders complete delivery and monetary details", () => {
    render(<AdminFulfillmentDetails order={makeOrder({
      fulfillment: {
        subtotalProducts: 20000,
        discountAmount: 2000,
        shippingFee: 4000,
        finalTotal: 22000,
        deliveryZone: {
          id: "rosario-zona-habilitada",
          name: "Rosario - zona de envío",
          insideZoneConfirmed: true,
        },
        deliveryAddress: {
          street: "San Lorenzo",
          number: "1234",
          floor: "2 A",
          betweenStreets: "Mitre y Entre Ríos",
          notes: "Timbre Estilo",
        },
        summary: "Envío a domicilio: San Lorenzo 1234",
      },
    })} />);

    expect(screen.getByText("Envío a domicilio")).toBeInTheDocument();
    expect(screen.getByText("San Lorenzo 1234")).toBeInTheDocument();
    expect(screen.getByText("Piso/unidad: 2 A")).toBeInTheDocument();
    expect(screen.getByText("Entre Mitre y Entre Ríos")).toBeInTheDocument();
    expect(screen.getByText("Notas de entrega: Timbre Estilo")).toBeInTheDocument();
    expect(screen.getByText("Zona: Rosario - zona de envío")).toBeInTheDocument();
    expect(screen.getByText("Subtotal")).toBeInTheDocument();
    expect(screen.getByText("Descuento")).toBeInTheDocument();
    expect(screen.getByText("Envío/entrega")).toBeInTheDocument();
    expect(screen.getByText("Total final")).toBeInTheDocument();
  });

  it("EF-E-02-05 renders the structured pickup point", () => {
    render(<AdminFulfillmentDetails order={makeOrder({
      deliveryMethod: "pickup",
      total: 18000,
      fulfillment: {
        subtotalProducts: 20000,
        discountAmount: 2000,
        shippingFee: 0,
        finalTotal: 18000,
        pickupPoint: {
          id: "santa-fe-mitre",
          name: "Santa Fe y Mitre",
          address: "Santa Fe y Mitre",
          reference: "Zona centro",
        },
        summary: "Punto de encuentro: Santa Fe y Mitre",
      },
    })} />);

    expect(screen.getByText("Punto de encuentro")).toBeInTheDocument();
    expect(screen.getAllByText("Santa Fe y Mitre").length).toBeGreaterThan(0);
    expect(screen.getByText("Dirección: Santa Fe y Mitre")).toBeInTheDocument();
    expect(screen.getByText("Referencia: Zona centro")).toBeInTheDocument();
  });

  it("EF-E-02-06 visibly flags an incomplete historical projection", () => {
    render(<AdminFulfillmentDetails order={makeOrder({ fulfillment: undefined })} />);

    expect(screen.getByText("Datos de entrega incompletos")).toBeInTheDocument();
  });
});
