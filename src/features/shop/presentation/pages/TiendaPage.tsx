import type { Product } from "@/src/features/shop/domain/entities/Product";
import { Suspense } from "react";
import TiendaClientView from "./TiendaClientView";
import {
  fetchProductsFromSheets,
  isMissingSheetsEndpointError,
} from "@/src/features/shop/infrastructure/data/fetchProducts";

// This page can include server-fetched products as initial data.
// On the client, the store performs a forced refresh only on the first
// visit of each tab session; subsequent reloads reuse the session cache.
export default async function TiendaPage() {
  const hasSheetsEndpoint = Boolean(
    process.env.NEXT_PUBLIC_SHEETS_ENDPOINT?.trim()
  );

  let staticProducts: Product[] = [];
  if (hasSheetsEndpoint) {
    try {
      staticProducts = await fetchProductsFromSheets({ layer: "catalog" });
    } catch (error) {
      if (!isMissingSheetsEndpointError(error)) {
        console.error("No se pudieron generar handles estáticos de detalle:", error);
      }
    }
  }

  const staticDetailHandles = staticProducts
    .map((product) => String(product.slug || product.id))
    .filter(Boolean);

  return (
    <Suspense
      fallback={
        <main className="min-h-screen bg-[var(--brand-violet-950)]" aria-busy="true" />
      }
    >
      <TiendaClientView
        initialProducts={staticProducts}
        staticDetailHandles={staticDetailHandles}
      />
    </Suspense>
  );
}
