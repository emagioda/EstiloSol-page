import { describe, expect, it } from "vitest";
import {
  canCompleteShipping,
  canRetryInventory,
  getInventoryIssueLabel,
  getInventoryStatusLabel,
  getOrderAction,
  isOrderNormallyCompleted,
  isOrderReadyForShipping,
  orderRequiresAttention,
} from "./inventoryUi";

describe("PR 2 admin inventory UI helpers", () => {
  it("labels all inventory states and legacy rows", () => {
    expect(getInventoryStatusLabel("pending")).toBe("Pendiente");
    expect(getInventoryStatusLabel("deducted")).toBe("Descontado");
    expect(getInventoryStatusLabel("conflict")).toBe("Conflicto");
    expect(getInventoryStatusLabel("error")).toBe("Error técnico");
    expect(getInventoryStatusLabel(undefined)).toBe("No registrado");
  });

  it("maps technical issue codes to friendly labels", () => {
    expect(getInventoryIssueLabel("conflict", "INSUFFICIENT_STOCK")).toBe("Stock insuficiente");
    expect(getInventoryIssueLabel("conflict", "UNEXPECTED")).toBe("Conflicto de inventario");
    expect(getInventoryIssueLabel("error", "SHEETS_TIMEOUT")).toBe(
      "No se pudo completar la actualización del inventario"
    );
  });

  it("prioritizes inventory attention over normal preparation", () => {
    expect(getOrderAction(
      { inventoryStatus: "conflict" },
      { paymentStatus: "confirmed", shippingStatus: "in_process" }
    )).toEqual({ label: "Requiere atención", tone: "review" });
  });

  it("excludes conflict and error from normal ready/completed filters", () => {
    expect(isOrderReadyForShipping({
      paymentStatus: "confirmed",
      shippingStatus: "in_process",
      inventoryStatus: "error",
      inventoryIssueCode: "SHEETS_TIMEOUT",
    })).toBe(false);
    expect(isOrderNormallyCompleted({
      paymentStatus: "confirmed",
      shippingStatus: "completed",
      inventoryStatus: "conflict",
      inventoryIssueCode: "INSUFFICIENT_STOCK",
    })).toBe(false);
  });

  it("UI-01 enables normal completion only with deducted inventory", () => {
    expect(canCompleteShipping("conflict")).toBe(false);
    expect(canCompleteShipping("error")).toBe(false);
    expect(canCompleteShipping("deducted")).toBe(true);
    expect(canCompleteShipping("pending")).toBe(false);
    expect(canCompleteShipping(undefined)).toBe(false);
  });

  it("UI-02 permits the explicit confirm-plus-complete operator action before first allocation", () => {
    expect(canCompleteShipping("pending", "pending", "confirmed")).toBe(true);
    expect(canCompleteShipping(undefined, "pending", "confirmed")).toBe(true);
    expect(canCompleteShipping("pending", "confirmed", "confirmed")).toBe(false);
    expect(canCompleteShipping("conflict", "pending", "confirmed")).toBe(false);
  });

  it("shows retry only for conflict/error", () => {
    expect(canRetryInventory("conflict")).toBe(true);
    expect(canRetryInventory("error")).toBe(true);
    expect(canRetryInventory("pending")).toBe(false);
    expect(canRetryInventory("deducted")).toBe(false);
    expect(canRetryInventory(undefined)).toBe(false);
  });

  it("marks a pending sales Sheet registration as requiring attention", () => {
    const order = {
      paymentStatus: "confirmed" as const,
      shippingStatus: "in_process" as const,
      inventoryStatus: "deducted" as const,
      inventoryIssueCode: "",
      salesSheetSyncPending: true,
    };

    expect(orderRequiresAttention(order)).toBe(true);
    expect(getOrderAction(order, order)).toEqual({
      label: "Requiere atención",
      tone: "review",
    });
  });

  it("excludes pending sales Sheet registrations from normal operational counters", () => {
    const order = {
      paymentStatus: "confirmed" as const,
      shippingStatus: "in_process" as const,
      inventoryStatus: "deducted" as const,
      inventoryIssueCode: "",
      salesSheetSyncPending: true,
    };

    expect(isOrderReadyForShipping(order)).toBe(false);
    expect(isOrderNormallyCompleted({ ...order, shippingStatus: "completed" })).toBe(false);
  });

  it("UI-03 excludes pending/legacy inventory from the normal ready counter", () => {
    const base = {
      paymentStatus: "confirmed" as const,
      shippingStatus: "in_process" as const,
      inventoryIssueCode: "",
    };
    expect(isOrderReadyForShipping({ ...base, inventoryStatus: "pending" })).toBe(false);
    expect(isOrderReadyForShipping({ ...base, inventoryStatus: undefined })).toBe(false);
    expect(isOrderReadyForShipping({ ...base, inventoryStatus: "deducted" })).toBe(true);
  });
});
