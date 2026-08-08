import { describe, expect, it } from "vitest";
import {
  canCompleteShipping,
  canRetryInventory,
  getInventoryIssueLabel,
  getInventoryStatusLabel,
  getOrderAction,
  isOrderNormallyCompleted,
  isOrderReadyForShipping,
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

  it("blocks completed only for explicit conflict/error, not legacy undefined", () => {
    expect(canCompleteShipping("conflict")).toBe(false);
    expect(canCompleteShipping("error")).toBe(false);
    expect(canCompleteShipping("deducted")).toBe(true);
    expect(canCompleteShipping(undefined)).toBe(true);
  });

  it("shows retry only for conflict/error", () => {
    expect(canRetryInventory("conflict")).toBe(true);
    expect(canRetryInventory("error")).toBe(true);
    expect(canRetryInventory("pending")).toBe(false);
    expect(canRetryInventory("deducted")).toBe(false);
    expect(canRetryInventory(undefined)).toBe(false);
  });
});
