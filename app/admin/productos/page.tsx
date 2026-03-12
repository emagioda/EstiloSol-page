import CatalogColumnsEditor from "@/app/admin/productos/CatalogColumnsEditor";
import type { AdminProductSheetRow } from "@/src/server/sheets/repository";
import { getProductsForAdmin } from "@/src/server/sheets/repository";

export const dynamic = "force-dynamic";

const sortProductsById = (products: AdminProductSheetRow[]) => {
  const list = [...products];
  list.sort((a, b) => a.id.localeCompare(b.id, "es", { sensitivity: "base" }));
  return list;
};

export default async function AdminProductosPage() {
  const products = await getProductsForAdmin();
  const peluqueriaProducts = sortProductsById(products.filter((product) => product.departament === "PELUQUERIA"));
  const bijouterieProducts = sortProductsById(products.filter((product) => product.departament === "BIJOUTERIE"));

  return (
    <CatalogColumnsEditor
      peluqueriaProducts={peluqueriaProducts}
      bijouterieProducts={bijouterieProducts}
    />
  );
}
