import type { Product } from "@/src/features/shop/domain/entities/Product";
import { Suspense } from "react";
import TiendaClientView from "./TiendaClientView";
import { fetchProductsFromCatalogSource } from "@/src/server/catalog/source";

export default async function TiendaPage() {
  let staticProducts: Product[] = [];

  try {
    staticProducts = await fetchProductsFromCatalogSource();
  } catch (error) {
    if (process.env.NODE_ENV !== "production") {
      console.error("No se pudieron cargar productos iniciales de tienda:", error);
    }
  }

  return (
    <Suspense
      fallback={
        <main className="min-h-screen bg-[var(--brand-violet-950)]" aria-busy="true" />
      }
    >
      <TiendaClientView
        initialProducts={staticProducts}
      />
    </Suspense>
  );
}
