import { notFound } from "next/navigation";
import ProductDetail from "@/src/features/shop/presentation/pages/ProductDetail";
import { fetchProductsFromSheets } from "@/src/features/shop/infrastructure/data/fetchProducts";
import type { Product } from "@/src/features/shop/presentation/view-models/useProductsStore";

type Props = { params: Promise<{ slug: string }> };

export async function generateStaticParams() {
  try {
    const products = (await fetchProductsFromSheets()) as Product[];
    return products
      .filter((p) => p.slug)
      .map((p) => ({ slug: String(p.slug) }));
  } catch (error) {
    console.error("Error generando static params:", error);
    return [];
  }
}

export default async function ProductDetailRoute({ params }: Props) {
  const { slug } = await params;

  const products = await fetchProductsFromSheets()
    .then((data) => data as Product[])
    .catch((error) => {
      console.error("Error fetching product detail:", error);
      return null;
    });

  if (!products) {
    notFound();
  }

  const product = products.find((item) => item.slug === slug || item.id === slug);

  if (!product) {
    notFound();
  }

  return <ProductDetail product={product} />;
}
