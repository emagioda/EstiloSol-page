import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Product } from "@/src/features/shop/domain/entities/Product";
import {
  clearProductsCatalogSessionCache,
  primeProductsCatalogCache,
} from "@/src/features/shop/presentation/view-models/useProductsStore";
import TiendaClientView from "./TiendaClientView";

const testMocks = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  setOpen: vi.fn(),
  setSuppressBadge: vi.fn(),
  setSuppressFloatingCart: vi.fn(),
  syncStockFromProducts: vi.fn(),
}));

vi.mock("next/dynamic", () => ({
  default: () => () => null,
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/tienda",
  useRouter: () => ({ push: testMocks.push, replace: testMocks.replace }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

vi.mock("@/src/features/shop/presentation/components/ProductsGrid/ProductsGrid", () => ({
  default: ({ products }: { products: Product[] }) => (
    <div data-testid="catalog-products">{products.map((product) => product.id).join(",")}</div>
  ),
}));
vi.mock("@/src/features/shop/presentation/components/FiltersSidebar/FiltersSidebar", () => ({
  default: () => null,
}));
vi.mock("@/src/features/shop/presentation/components/StoreToolbar/StoreToolbar", () => ({
  default: () => null,
}));
vi.mock("@/src/features/shop/presentation/components/LoadingGrid/LoadingGrid", () => ({
  default: () => null,
}));
vi.mock("@/src/features/shop/presentation/components/Breadcrumbs", () => ({
  default: () => null,
}));
vi.mock("@/src/features/shop/presentation/components/BackToTopButton/BackToTopButton", () => ({
  default: () => null,
}));

vi.mock("@/src/features/shop/presentation/lib/shopScrollRestoration", () => ({
  clearShopScrollRestoreRequest: vi.fn(),
  getShopScrollCacheRestoreKey: vi.fn(() => ""),
  isMatchingShopListingCache: vi.fn(() => false),
  isShopScrollRestoreRequested: vi.fn(() => false),
  readShopScrollCache: vi.fn(() => null),
  restoreWindowScroll: vi.fn(() => vi.fn()),
  writeShopScrollCache: vi.fn(),
}));
vi.mock("@/src/features/shop/presentation/view-models/useCartBadgeVisibility", () => ({
  useCartBadgeVisibility: () => ({
    setSuppressBadge: testMocks.setSuppressBadge,
    setSuppressFloatingCart: testMocks.setSuppressFloatingCart,
  }),
}));
vi.mock("@/src/features/shop/presentation/view-models/useCartDrawer", () => ({
  useCartDrawer: () => ({ setOpen: testMocks.setOpen }),
}));
vi.mock("@/src/features/shop/presentation/view-models/useCartStore", () => ({
  useCart: () => ({ syncStockFromProducts: testMocks.syncStockFromProducts }),
}));
vi.mock("@/src/core/presentation/hooks/useBodyScrollLock", () => ({
  useBodyScrollLock: vi.fn(),
}));

const cachedCatalogA: Product[] = [
  {
    id: "cached-a",
    name: "Catálogo anterior",
    departament: "PELUQUERIA",
    category: "Tratamientos",
    price: 1000,
  },
];

const serverCatalogB: Product[] = [
  {
    id: "server-b",
    name: "Snapshot del servidor",
    departament: "PELUQUERIA",
    category: "Tratamientos",
    price: 1200,
  },
];

describe("TiendaClientView catalog bootstrap", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.sessionStorage.clear();
    clearProductsCatalogSessionCache();
    vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn(() => ({ matches: false })),
    });
  });

  it("does not request the catalog again when the server supplied a complete snapshot", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify([]), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    primeProductsCatalogCache(cachedCatalogA, { complete: true });

    render(
      <TiendaClientView
        initialProducts={serverCatalogB}
        initialCatalogComplete={true}
      />,
    );
    await act(async () => Promise.resolve());

    expect(screen.getByTestId("catalog-products")).toHaveTextContent("server-b");
    expect(screen.getByTestId("catalog-products")).not.toHaveTextContent("cached-a");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
