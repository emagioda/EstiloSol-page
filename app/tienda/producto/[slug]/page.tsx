import { notFound } from "next/navigation";
import { fetchProductsFromSheets } from "@/src/features/shop/infrastructure/data/fetchProducts";
import ProductDetail from "@/src/features/shop/presentation/pages/ProductDetail";
import type { Product } from "@/src/features/shop/domain/entities/Product";

export async function generateStaticParams() {
  try {
    const products = await fetchProductsFromSheets();
    return products
      .map((product) => product.slug)
      .filter((slug): slug is string => Boolean(slug))
      .map((slug) => ({ slug }));
  } catch (error) {
    console.error("Error generando static params:", error);
    return [];
  }
}

type Props = { params: Promise<{ slug: string }> };

const findProductBySlugOrId = (products: Product[], slugParam: string) => {
  const decodedSlug = decodeURIComponent(slugParam);
  return products.find(
    (product) => product.slug === decodedSlug || String(product.id) === decodedSlug
  );
};

export default async function ProductDetailRoute({ params }: Props) {
  const resolvedParams = await params;

  let product: Product | undefined;
  try {
    const products = await fetchProductsFromSheets();
    product = findProductBySlugOrId(products, resolvedParams.slug);
  } catch (error) {
    console.error("Error obteniendo producto:", error);
  }

  if (!product) {
    notFound();
  }

  return <ProductDetail product={product} />;
}
