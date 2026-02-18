import type { Product } from "@/src/features/shop/domain/entities/Product";
import TiendaClientView from "./TiendaClientView";
import {
  fetchProductsFromSheets,
  isMissingSheetsEndpointError,
} from "@/src/features/shop/infrastructure/data/fetchProducts";

export default async function TiendaPage() {
  const hasSheetsEndpoint = Boolean(
    process.env.NEXT_PUBLIC_SHEETS_ENDPOINT?.trim()
  );

  let staticProducts: Product[] = [];
  if (hasSheetsEndpoint) {
    try {
      staticProducts = await fetchProductsFromSheets();
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
      initialProducts={[]}
      staticDetailHandles={staticDetailHandles}
      storeHeading="Productos Profesionales y Diseños Únicos"
      storeDescription="Encontrá todo para consentirte: cuidado profesional para tu cabello y bijouterie divina en un mismo lugar."
    />
  );
}
