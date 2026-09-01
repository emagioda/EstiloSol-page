import type { Departament, Product } from "@/src/features/shop/domain/entities/Product";
import { fetchProductsFromCatalogSource } from "@/src/server/catalog/source";
import TiendaClientView from "./TiendaClientView";

export default async function TiendaPage({
  initialDepartament = "PELUQUERIA",
}: {
  initialDepartament?: Departament;
}) {
  let initialProducts: Product[] = [];
  let initialCatalogComplete = false;

  try {
    initialProducts = await fetchProductsFromCatalogSource();
    initialCatalogComplete = true;
  } catch {
    // The client keeps the existing retry/error path when the server read fails.
  }

  return (
    <TiendaClientView
      initialProducts={initialProducts}
      initialCatalogComplete={initialCatalogComplete}
      initialDepartament={initialDepartament}
    />
  );
}
