import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import SuccessPage from "@/app/tienda/success/page";
import CheckoutSteps from "./CheckoutSteps";
import { useCart } from "../../view-models/useCartStore";

vi.mock("../../view-models/useCartStore");

const mockUseCart = useCart as ReturnType<typeof vi.fn>;

const validDeliveryAddressDraft = {
  street: "San Lorenzo",
  number: "1234",
  floor: "",
  betweenStreets: "Mitre y Entre Rios",
  notes: "",
  insideZoneConfirmed: true,
};

const fillContactFields = async () => {
  fireEvent.change(await screen.findByLabelText(/^Nombre$/i), { target: { value: "Jane" } });
  fireEvent.change(screen.getByLabelText(/^Apellido$/i), { target: { value: "Smith" } });
  fireEvent.change(screen.getByLabelText(/^WhatsApp$/i), { target: { value: "5491198765432" } });
  fireEvent.change(screen.getByLabelText(/^Email$/i), { target: { value: "jane@example.com" } });
};

const fillDeliveryFields = () => {
  fireEvent.click(screen.getByLabelText(/Confirmo que mi dirección está dentro/i));
  fireEvent.change(screen.getByLabelText(/^Calle$/i), { target: { value: "San Lorenzo" } });
  fireEvent.change(screen.getByLabelText(/Número/i), { target: { value: "1234" } });
  fireEvent.change(screen.getByLabelText(/Entre calles/i), { target: { value: "Mitre y Entre Rios" } });
};

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
        deliveryAddress: validDeliveryAddressDraft,
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
      pickupPointId: "santa-fe-mitre",
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
        pickupPointId: "santa-fe-mitre",
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
        deliveryAddress: validDeliveryAddressDraft,
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

    await fillContactFields();
    fillDeliveryFields();
    fireEvent.click(screen.getByRole("button", { name: /Continuar al pago/i }));

    expect(await screen.findByText(/Cliente:/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Finalizar pedido/i })).toBeEnabled();
    expect(fetch).not.toHaveBeenCalledWith("/api/mp/validate-cart", expect.anything());
  });

  it("starts Mercado Pago checkout through create-preference without validate-cart preflight", async () => {
    const fetchMock = vi.fn(async (url: RequestInfo | URL) => {
      if (String(url) === "/api/mp/create-preference") {
        return {
          ok: false,
          json: async () => ({ error: "No pudimos iniciar el pago. Intenta nuevamente." }),
        };
      }

      if (String(url) === "/api/mp/validate-cart") {
        throw new Error("validate-cart should not block Mercado Pago checkout");
      }

      return { ok: true, json: async () => [] };
    });
    vi.stubGlobal("fetch", fetchMock);

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

    await fillContactFields();
    fillDeliveryFields();
    fireEvent.click(screen.getByRole("button", { name: /Continuar al pago/i }));
    fireEvent.click(await screen.findByRole("button", { name: /Finalizar pedido/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/mp/create-preference", expect.anything());
    });
    expect(fetchMock).not.toHaveBeenCalledWith("/api/mp/validate-cart", expect.anything());

    const createCall = fetchMock.mock.calls.find(([url]) => String(url) === "/api/mp/create-preference") as
      | [RequestInfo | URL, RequestInit | undefined]
      | undefined;
    const payload = JSON.parse(String(createCall?.[1]?.body || "{}")) as { checkoutAttemptId?: string };
    expect(payload.checkoutAttemptId).toMatch(/^ca_[a-zA-Z0-9_-]+$/);
  });

  it("shows a single combined progress message while Mercado Pago validates and prepares payment", async () => {
    const pendingCreatePreference = new Promise<never>(() => {});
    const fetchMock = vi.fn((url: RequestInfo | URL) => {
      if (String(url) === "/api/mp/create-preference") {
        return pendingCreatePreference;
      }

      return Promise.resolve({ ok: true, json: async () => [] } as Response);
    });
    vi.stubGlobal("fetch", fetchMock);

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

    await fillContactFields();
    fillDeliveryFields();
    fireEvent.click(screen.getByRole("button", { name: /Continuar al pago/i }));
    fireEvent.click(await screen.findByRole("button", { name: /Finalizar pedido/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/mp/create-preference", expect.anything());
    });
    expect(screen.getByText("Validando carrito y preparando pago seguro")).toBeInTheDocument();
    expect(
      screen.getByText("Revisando productos, precios, stock y creando el enlace de Mercado Pago.")
    ).toBeInTheDocument();
    expect(screen.queryByText(/^Validando carrito$/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^Preparando pago seguro$/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Validando y preparando pago/i })).toBeDisabled();
  });

  it("refreshes the cached catalog when Mercado Pago validation returns invalid products", async () => {
    const syncStockFromProducts = vi.fn();
    const fetchMock = vi.fn(async (...[url]: [RequestInfo | URL, RequestInit?]) => {
      const requestUrl = String(url);

      if (requestUrl === "/api/mp/create-preference") {
        return {
          ok: false,
          json: async () => ({
            error: "El precio de algunos productos cambio.",
            invalidProducts: [
              {
                productId: "p1",
                name: "Producto 1",
                reason: "price_changed",
                requestedQty: 1,
                availableQty: 5,
                requestedPrice: 100,
                currentPrice: 120,
                stockStatus: "in_stock",
              },
            ],
          }),
        };
      }

      if (requestUrl.startsWith("/api/catalog?_ts=")) {
        return { ok: true, json: async () => [] };
      }

      return { ok: true, json: async () => [] };
    });
    vi.stubGlobal("fetch", fetchMock);

    mockUseCart.mockReturnValue({
      items: [{ productId: "p1", name: "Producto 1", unitPrice: 100, qty: 1 }],
      paymentMethod: "mercadopago",
      setPaymentMethod: vi.fn(),
      removeItem: vi.fn(),
      addItem: vi.fn(() => ({ ok: true, addedQty: 1, finalQty: 1, maxQty: null })),
      updateQty: vi.fn(),
      syncStockFromProducts,
      clear: vi.fn(),
      getTotal: () => 100,
      getDiscountedTotal: () => 100,
    });

    render(<CheckoutSteps subtotal={100} discountedTotal={100} />);

    await fillContactFields();
    fillDeliveryFields();
    fireEvent.click(screen.getByRole("button", { name: /Continuar al pago/i }));
    fireEvent.click(await screen.findByRole("button", { name: /Finalizar pedido/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/mp/create-preference", expect.anything());
    });
    expect(syncStockFromProducts).toHaveBeenCalledWith([
      expect.objectContaining({
        id: "p1",
        name: "Producto 1",
        price: 120,
        stock_status: "in_stock",
        stock_qty: 5,
      }),
    ]);
    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(
          ([url, init]) =>
            String(url).startsWith("/api/catalog?_ts=") &&
            (init as RequestInit | undefined)?.cache === "no-store",
        ),
      ).toBe(true);
    });
  });

  it("keeps delivery checkout blocked until address details are complete", async () => {
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

    await fillContactFields();

    expect(screen.getByRole("button", { name: /Continuar al pago/i })).toBeDisabled();
    expect(screen.queryByLabelText(/^Calle$/i)).not.toBeInTheDocument();
    expect(screen.queryByText("Ingresá la calle.")).not.toBeInTheDocument();
    expect(screen.queryByText("Confirmá que la dirección está dentro de la zona de envío.")).not.toBeInTheDocument();

    fireEvent.click(screen.getByLabelText(/Confirmo que mi dirección está dentro/i));

    expect(screen.getByText("Ingresá la calle.")).toBeInTheDocument();
    expect(screen.getByText("Ingresá el número.")).toBeInTheDocument();
    expect(screen.getByText("Ingresá las calles de referencia.")).toBeInTheDocument();
  });

  it("requires a pickup point before continuing", async () => {
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

    fireEvent.click(screen.getByText("Punto de encuentro"));
    await fillContactFields();

    expect(screen.getByRole("button", { name: /Continuar al pago/i })).toBeDisabled();
    expect(screen.getByText("Seleccioná un punto de encuentro para continuar.")).toBeInTheDocument();

    fireEvent.click(screen.getAllByText("Santa Fe y Mitre")[0]);
    expect(screen.getByRole("button", { name: /Continuar al pago/i })).toBeEnabled();
  });

  it("shows pickup point prices instead of a free pickup badge", async () => {
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

    fireEvent.click(screen.getByText("Punto de encuentro"));

    expect(screen.queryByText("Gratis")).not.toBeInTheDocument();
    expect(screen.getByText(/Desde\s+\$\s*3\.000/i)).toBeInTheDocument();
    expect(screen.getAllByText(/\$\s*3\.000/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/El costo se suma al total/i)).toBeInTheDocument();
  });

  it("sends fulfillment in the manual order payload", async () => {
    const fetchMock = vi.fn(async (url: RequestInfo | URL) => {
      if (String(url) === "/api/mp/validate-cart") {
        return { ok: true, json: async () => ({ ok: true }) };
      }

      if (String(url) === "/api/orders/create") {
        return {
          ok: true,
          json: async () => ({
            externalReference: "",
            summaryToken: "summary-token",
          }),
        };
      }

      return { ok: true, json: async () => [] };
    });
    vi.stubGlobal("fetch", fetchMock);

    mockUseCart.mockReturnValue({
      items: [{ productId: "p1", name: "Producto 1", unitPrice: 100, qty: 1 }],
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

    fireEvent.click(screen.getByText("Punto de encuentro"));
    fireEvent.click(screen.getAllByText("Santa Fe y Mitre")[0]);
    await fillContactFields();
    fireEvent.click(screen.getByRole("button", { name: /Continuar al pago/i }));
    fireEvent.click(await screen.findByRole("button", { name: /Finalizar pedido/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/orders/create", expect.anything());
    });

    const createCall = fetchMock.mock.calls.find(([url]) => String(url) === "/api/orders/create") as unknown as
      | [RequestInfo | URL, RequestInit | undefined]
      | undefined;
    const payload = JSON.parse(String(createCall?.[1]?.body || "{}")) as {
      fulfillment?: { pickupPointId?: string };
      shippingFee?: number;
    };
    expect(payload.fulfillment?.pickupPointId).toBe("santa-fe-mitre");
    expect(payload.shippingFee).toBeUndefined();
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

    await fillContactFields();
    fillDeliveryFields();
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

    await fillContactFields();
    fillDeliveryFields();
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

  it("uses POST while polling Mercado Pago from the success page", async () => {
    const clear = vi.fn();
    const ref = "es-20260101-000000-successpost";
    const summaryToken = "summary-token";

    window.history.pushState(
      {},
      "",
      `/tienda/success?ref=${ref}&summaryToken=${summaryToken}&status=approved&payment_id=123456`
    );

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/mp/verify-payment") {
        expect(init?.method).toBe("POST");
        expect(JSON.parse(String(init?.body || "{}"))).toMatchObject({
          ref,
          paymentId: "123456",
        });
        return {
          ok: true,
          json: async () => ({
            approved: true,
            paymentId: "123456",
            externalReference: ref,
            date: "01/01/2026, 10:00:00",
          }),
        };
      }

      if (String(input).startsWith("http://localhost:3000/api/orders/")) {
        const url = new URL(String(input));
        expect(url.searchParams.get("summaryToken")).toBe(summaryToken);
        return {
          ok: true,
          json: async () => ({
            externalReference: ref,
            total: 1000,
            currency: "ARS",
            createdAt: Date.now(),
            items: [],
          }),
        };
      }

      throw new Error(`Unexpected fetch url: ${String(input)}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    mockUseCart.mockReturnValue({
      items: [],
      paymentMethod: "mercadopago",
      setPaymentMethod: vi.fn(),
      removeItem: vi.fn(),
      addItem: vi.fn(() => ({ ok: true, addedQty: 1, finalQty: 1, maxQty: null })),
      updateQty: vi.fn(),
      syncStockFromProducts: vi.fn(),
      clear,
      getTotal: () => 0,
      getDiscountedTotal: () => 0,
    });

    render(<SuccessPage />);

    await waitFor(() => {
      expect(screen.getByText(/Pago confirmado/i)).toBeInTheDocument();
    });

    expect(clear).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/mp/verify-payment",
      expect.objectContaining({ method: "POST" })
    );
  });
});
