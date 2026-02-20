import { notFound } from "next/navigation";
import { fetchProductsFromSheets } from "@/src/features/shop/infrastructure/data/fetchProducts";
import ProductDetail from "@/src/features/shop/presentation/pages/ProductDetail";
import type { Product } from "@/src/features/shop/domain/entities/Product";

export const dynamicParams = false;
// page is statically generated; dynamic rendering isn't possible with
// `output: "export"` (GitHub Pages). data freshness is handled on the
// client side instead.

export async function generateStaticParams() {
  try {
    const products = await fetchProductsFromSheets({ cacheMode: "force-cache" });
    const handles = products
      .map((p) => (p.slug && p.slug.trim() ? p.slug.trim() : String(p.id)))
      .filter((h) => h && h.length > 0);

    if (handles.length > 0) {
      return handles.map((slug) => ({ slug }));
    }

    console.warn(
      "No hay productos activos en el Sheet. Verificá que NEXT_PUBLIC_SHEETS_ENDPOINT esté configurado."
    );
  } catch (error) {
    console.error("Error al conectar con Sheets:", error);
  }

  // fallback: intentar con el mock local
  try {
    const mock: unknown = (
      await import("@/src/features/shop/infrastructure/data/products.mock.json")
    ).default;
    if (Array.isArray(mock)) {
      const mockHandles = mock
        .map((p: any) => (p.slug && p.slug.trim() ? p.slug.trim() : String(p.id)))
        .filter((h: string) => h && h.length > 0);

      if (mockHandles.length > 0) {
        console.info("Usando mock local para rutas estáticas");
        return mockHandles.map((slug: string) => ({ slug }));
      }
    }
  } catch (mockError) {
    console.error("Error cargando mock local:", mockError);
  }

  return [];
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
    const products = await fetchProductsFromSheets({ cacheMode: "force-cache" });
    product = findProductBySlugOrId(products, resolvedParams.slug);
  } catch (error) {
    console.error("Error obteniendo producto:", error);
  }

  // note: the client component will re‑query the store on mount and may
  // replace this product if the sheet has changed.

  if (!product) {
    notFound();
  }

  return <ProductDetail product={product} slug={resolvedParams.slug} />;
}
