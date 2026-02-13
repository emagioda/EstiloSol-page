import type { Product } from "../view-models/useProductsStore";
import TiendaClientView from "./TiendaClientView";
import { fetchProductsFromSheets } from "@/src/features/shop/infrastructure/data/fetchProducts";

export default async function TiendaPage() {
  let products: Product[] = [];
  try {
    const data = await fetchProductsFromSheets();
    products = data as Product[];
  } catch (error) {
    console.error("Error fetching products on server:", error);
  }

  return (
    <TiendaClientView
      initialProducts={products}
      storeHeading="Productos Profesionales y Diseños Únicos"
      storeDescription="Encontrá todo para consentirte: cuidado profesional para tu cabello y bijouterie divina en un mismo lugar."
    />
  );
}
