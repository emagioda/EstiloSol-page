import type { Product } from "@/src/features/shop/domain/entities/Product";
import TiendaClientView from "./TiendaClientView";
import {
  fetchProductsFromSheets,
  isMissingSheetsEndpointError,
} from "@/src/features/shop/infrastructure/data/fetchProducts";

// This page is statically exported for GitHub Pages. it will
// include whatever catalog was available at build time, but the
// client bundle will immediately re‑fetch on load so users always see
// up‑to‑date data when they manually reload.
export default async function TiendaPage() {
  const hasSheetsEndpoint = Boolean(
    process.env.NEXT_PUBLIC_SHEETS_ENDPOINT?.trim()
  );

  let staticProducts: Product[] = [];
  if (hasSheetsEndpoint) {
    try {
      // always request fresh data on each page load
      staticProducts = await fetchProductsFromSheets({ cacheMode: "force-cache" });
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
    <TiendaClientView
      initialProducts={staticProducts}
      staticDetailHandles={staticDetailHandles}
      storeHeading="Productos Profesionales y Diseños Únicos"
      storeDescription="Encontrá todo para consentirte: cuidado profesional para tu cabello y bijouterie divina en un mismo lugar."
    />
  );
}
