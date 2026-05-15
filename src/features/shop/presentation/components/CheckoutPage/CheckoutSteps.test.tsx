import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import SuccessPage from "@/app/tienda/success/page";
import CheckoutSteps from "./CheckoutSteps";
import { useCart } from "../../view-models/useCartStore";

vi.mock("../../view-models/useCartStore");

const mockUseCart = useCart as ReturnType<typeof vi.fn>;

describe("CheckoutSteps Auto-Advance", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          externalReference: "ORDER-123",
          total: 100,
          currency: "ARS",
          createdAt: Date.now(),
          items: [],
        }),
      }))
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  it("should NOT auto-complete Step 1 when starting a new purchase after old draft exists", async () => {
    // Simulate old draft from previous purchase
    localStorage.setItem(
      "es_sol_checkout_draft",
      JSON.stringify({
        firstName: "John",
        lastName: "Doe",
        email: "john@example.com",
        whatsapp: "5491112345678",
        step1Completed: true,
        deliveryMethod: "delivery",
        paymentMethod: "mercadopago",
      })
    );

    mockUseCart.mockReturnValue({
      items: [], // Start with empty cart (post-purchase state)
      paymentMethod: "mercadopago",
      setPaymentMethod: vi.fn(),
      removeItem: vi.fn(),
      addItem: vi.fn(() => ({ ok: true, addedQty: 1, finalQty: 1, maxQty: null })),
      updateQty: vi.fn(),
      syncStockFromProducts: vi.fn(),
      clear: vi.fn(),
      getTotal: () => 0,
      getDiscountedTotal: () => 0,
    });

    const { rerender } = render(
      <CheckoutSteps subtotal={0} discountedTotal={0} />
    );

    // Now add items (simulating new purchase)
    mockUseCart.mockReturnValue({
      items: [{ productId: "p1", name: "Producto 1", unitPrice: 100, qty: 1 }],
      paymentMethod: "mercadopago",
      setPaymentMethod: vi.fn(),
      removeItem: vi.fn(),
      addItem: vi.fn(() => ({ ok: true, addedQty: 1, finalQty: 1, maxQty: null })),
      updateQty: vi.fn(),
      syncStockFromProducts: vi.fn(),
      clear: vi.fn(),
      getTotal: () => 100,
      getDiscountedTotal: () => 100,
    });

    rerender(<CheckoutSteps subtotal={100} discountedTotal={100} />);

    await waitFor(() => {
      // Step 1 form should be visible (not auto-completed)
      expect(screen.getByLabelText(/Nombre/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/Nombre/i)).toHaveValue(""); // Form should be cleared
    });
  });

  it("should show checkout draft data when returning during same session", async () => {
    const draft = {
      firstName: "Jane",
      lastName: "Smith",
      email: "jane@example.com",
      whatsapp: "5491198765432",
      step1Completed: false, // Not yet completed
      deliveryMethod: "pickup",
      paymentMethod: "transfer",
    };
    localStorage.setItem("es_sol_checkout_draft", JSON.stringify(draft));

    mockUseCart.mockReturnValue({
      items: [{ productId: "p1", name: "Producto 1", unitPrice: 100, qty: 1 }],
      paymentMethod: "transfer",
      setPaymentMethod: vi.fn(),
      removeItem: vi.fn(),
      addItem: vi.fn(() => ({ ok: true, addedQty: 1, finalQty: 1, maxQty: null })),
      updateQty: vi.fn(),
      syncStockFromProducts: vi.fn(),
      clear: vi.fn(),
      getTotal: () => 100,
      getDiscountedTotal: () => 100,
    });

    render(<CheckoutSteps subtotal={100} discountedTotal={100} />);

    await waitFor(() => {
      expect(screen.getByLabelText(/Nombre/i)).toHaveValue("Jane");
      expect(screen.getByLabelText(/Apellido/i)).toHaveValue("Smith");
    });
  });

  it("keeps completed Step 1 when returning to checkout with an existing cart", async () => {
    localStorage.setItem(
      "es_sol_checkout_draft",
      JSON.stringify({
        firstName: "Jane",
        lastName: "Smith",
        email: "jane@example.com",
        whatsapp: "5491198765432",
        step1Completed: true,
        deliveryMethod: "pickup",
        paymentMethod: "transfer",
      })
    );

    mockUseCart.mockReturnValue({
      items: [{ productId: "p1", name: "Producto 1", unitPrice: 100, qty: 1 }],
      paymentMethod: "transfer",
      setPaymentMethod: vi.fn(),
      removeItem: vi.fn(),
      addItem: vi.fn(() => ({ ok: true, addedQty: 1, finalQty: 1, maxQty: null })),
      updateQty: vi.fn(),
      syncStockFromProducts: vi.fn(),
      clear: vi.fn(),
      getTotal: () => 100,
      getDiscountedTotal: () => 90,
    });

    render(<CheckoutSteps subtotal={100} discountedTotal={90} />);

    await waitFor(() => {
      expect(screen.getByText(/Cliente:/i)).toBeInTheDocument();
      expect(screen.getByText(/Jane Smith/i)).toBeInTheDocument();
    });

    expect(screen.getByRole("button", { name: /Finalizar pedido/i })).toBeEnabled();
    expect(screen.queryByLabelText(/Nombre/i)).not.toBeInTheDocument();
  });

  it("disables payment actions while editing Step 1 from Step 2", async () => {
    localStorage.setItem(
      "es_sol_checkout_draft",
      JSON.stringify({
        firstName: "Jane",
        lastName: "Smith",
        email: "jane@example.com",
        whatsapp: "5491198765432",
        step1Completed: true,
        deliveryMethod: "delivery",
        paymentMethod: "mercadopago",
      })
    );

    mockUseCart.mockReturnValue({
      items: [{ productId: "p1", name: "Producto 1", unitPrice: 100, qty: 1 }],
      paymentMethod: "mercadopago",
      setPaymentMethod: vi.fn(),
      removeItem: vi.fn(),
      addItem: vi.fn(() => ({ ok: true, addedQty: 1, finalQty: 1, maxQty: null })),
      updateQty: vi.fn(),
      syncStockFromProducts: vi.fn(),
      clear: vi.fn(),
      getTotal: () => 100,
      getDiscountedTotal: () => 100,
    });

    render(<CheckoutSteps subtotal={100} discountedTotal={100} />);

    fireEvent.click(await screen.findByRole("button", { name: /Cambiar/i }));

    expect(screen.getByLabelText(/Nombre/i)).toHaveValue("Jane");
    expect(screen.getByText(/Completa primero los datos de contacto/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Finalizar pedido/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Continuar al pago/i })).toBeEnabled();
  });

  it("moves from Step 1 to Step 2 without validating cart stock", async () => {
    mockUseCart.mockReturnValue({
      items: [{ productId: "p1", name: "Producto 1", unitPrice: 100, qty: 1 }],
      paymentMethod: "mercadopago",
      setPaymentMethod: vi.fn(),
      removeItem: vi.fn(),
      addItem: vi.fn(() => ({ ok: true, addedQty: 1, finalQty: 1, maxQty: null })),
      updateQty: vi.fn(),
      syncStockFromProducts: vi.fn(),
      clear: vi.fn(),
      getTotal: () => 100,
      getDiscountedTotal: () => 100,
    });

    render(<CheckoutSteps subtotal={100} discountedTotal={100} />);

    fireEvent.change(await screen.findByLabelText(/Nombre/i), { target: { value: "Jane" } });
    fireEvent.change(screen.getByLabelText(/Apellido/i), { target: { value: "Smith" } });
    fireEvent.change(screen.getByLabelText(/WhatsApp/i), { target: { value: "5491198765432" } });
    fireEvent.change(screen.getByLabelText(/Email/i), { target: { value: "jane@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: /Continuar al pago/i }));

    expect(await screen.findByText(/Cliente:/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Finalizar pedido/i })).toBeEnabled();
    expect(fetch).not.toHaveBeenCalledWith("/api/mp/validate-cart", expect.anything());
  });

  it("validates cart stock before creating a manual order", async () => {
    const fetchMock = vi.fn(async (url: RequestInfo | URL) => {
      if (String(url) === "/api/mp/validate-cart") {
        return {
          ok: false,
          json: async () => ({
            error: "Algunos productos no tienen stock suficiente. Ajusta el carrito para continuar.",
            invalidProducts: [{ productId: "p1", name: "Thermo Protector", reason: "out_of_stock", availableQty: 0 }],
          }),
        };
      }

      if (String(url).startsWith("/api/catalog")) {
        return {
          ok: true,
          json: async () => [],
        };
      }

      return {
        ok: true,
        json: async () => ({
          externalReference: "ORDER-123",
        }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    mockUseCart.mockReturnValue({
      items: [{ productId: "p1", name: "Thermo Protector", unitPrice: 100, qty: 1 }],
      paymentMethod: "cash",
      setPaymentMethod: vi.fn(),
      removeItem: vi.fn(),
      addItem: vi.fn(() => ({ ok: true, addedQty: 1, finalQty: 1, maxQty: null })),
      updateQty: vi.fn(),
      syncStockFromProducts: vi.fn(),
      clear: vi.fn(),
      getTotal: () => 100,
      getDiscountedTotal: () => 90,
    });

    render(<CheckoutSteps subtotal={100} discountedTotal={90} />);

    fireEvent.change(await screen.findByLabelText(/Nombre/i), { target: { value: "Jane" } });
    fireEvent.change(screen.getByLabelText(/Apellido/i), { target: { value: "Smith" } });
    fireEvent.change(screen.getByLabelText(/WhatsApp/i), { target: { value: "5491198765432" } });
    fireEvent.change(screen.getByLabelText(/Email/i), { target: { value: "jane@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: /Continuar al pago/i }));
    fireEvent.click(await screen.findByRole("button", { name: /Finalizar pedido/i }));

    expect(await screen.findByText(/Algunos productos no tienen stock suficiente/i)).toBeInTheDocument();
    expect(screen.getByText(/Thermo Protector/i)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith("/api/mp/validate-cart", expect.anything());
    expect(fetchMock).not.toHaveBeenCalledWith("/api/orders/create", expect.anything());

    vi.useRealTimers();
  });

  it("groups price changes separately from unavailable products", async () => {
    const fetchMock = vi.fn(async (url: RequestInfo | URL) => {
      if (String(url) === "/api/mp/validate-cart") {
        return {
          ok: false,
          json: async () => ({
            error: "Hay cambios en el carrito. Revisa los productos marcados antes de continuar.",
            invalidProducts: [
              {
                productId: "p1",
                name: "Ampollita Hyaluronic",
                reason: "price_changed",
                requestedPrice: 12000,
                currentPrice: 350000,
                availableQty: 2,
                stockStatus: "in_stock",
              },
              { productId: "p2", name: "Thermo Protector", reason: "out_of_stock", availableQty: 0 },
            ],
          }),
        };
      }

      if (String(url).startsWith("/api/catalog")) {
        return {
          ok: true,
          json: async () => [],
        };
      }

      return {
        ok: true,
        json: async () => ({ externalReference: "ORDER-123" }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    mockUseCart.mockReturnValue({
      items: [
        { productId: "p1", name: "Ampollita Hyaluronic", unitPrice: 12000, qty: 1 },
        { productId: "p2", name: "Thermo Protector", unitPrice: 10500, qty: 1 },
      ],
      paymentMethod: "cash",
      setPaymentMethod: vi.fn(),
      removeItem: vi.fn(),
      addItem: vi.fn(() => ({ ok: true, addedQty: 1, finalQty: 1, maxQty: null })),
      updateQty: vi.fn(),
      syncStockFromProducts: vi.fn(),
      clear: vi.fn(),
      getTotal: () => 22500,
      getDiscountedTotal: () => 20250,
    });

    render(<CheckoutSteps subtotal={22500} discountedTotal={20250} />);

    fireEvent.change(await screen.findByLabelText(/Nombre/i), { target: { value: "Jane" } });
    fireEvent.change(screen.getByLabelText(/Apellido/i), { target: { value: "Smith" } });
    fireEvent.change(screen.getByLabelText(/WhatsApp/i), { target: { value: "5491198765432" } });
    fireEvent.change(screen.getByLabelText(/Email/i), { target: { value: "jane@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: /Continuar al pago/i }));
    fireEvent.click(await screen.findByRole("button", { name: /Finalizar pedido/i }));

    expect(await screen.findByText(/Hay cambios en el carrito/i)).toBeInTheDocument();
    expect(screen.getByText(/Precios actualizados/i)).toBeInTheDocument();
    expect(screen.getByText(/Ampollita Hyaluronic/i)).toBeInTheDocument();
    expect(screen.getAllByText(/No disponibles/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/Thermo Protector/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Quitar no disponibles/i })).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalledWith("/api/orders/create", expect.anything());
  });

  it("clears cart and checkout draft after finishing a manual order", async () => {
    const clear = vi.fn();
    localStorage.setItem(
      "es_sol_checkout_draft",
      JSON.stringify({
        firstName: "Jane",
        lastName: "Smith",
        email: "jane@example.com",
        whatsapp: "5491198765432",
        step1Completed: true,
        deliveryMethod: "delivery",
        paymentMethod: "cash",
      })
    );
    window.history.pushState({}, "", "/tienda/success?manual=1&pm=cash&ref=ORDER-123");

    mockUseCart.mockReturnValue({
      items: [{ productId: "p1", name: "Producto 1", unitPrice: 100, qty: 1 }],
      paymentMethod: "cash",
      setPaymentMethod: vi.fn(),
      removeItem: vi.fn(),
      addItem: vi.fn(() => ({ ok: true, addedQty: 1, finalQty: 1, maxQty: null })),
      updateQty: vi.fn(),
      syncStockFromProducts: vi.fn(),
      clear,
      getTotal: () => 100,
      getDiscountedTotal: () => 90,
    });

    render(<SuccessPage />);

    await waitFor(() => {
      expect(screen.getByText(/Pago pendiente/i)).toBeInTheDocument();
    });

    expect(clear).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem("es_sol_checkout_draft")).toBeNull();
    expect(screen.getAllByText(/Pedido registrado/i).length).toBeGreaterThan(0);
  });
});
