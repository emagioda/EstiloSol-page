import ProductDetail from "@/src/features/shop/presentation/pages/ProductDetail";

// 1. Definimos la URL de tu Google Sheet (la misma que usas en el store)
const SHEETS_ENDPOINT =
  process.env.NEXT_PUBLIC_SHEETS_ENDPOINT ||
  "https://script.google.com/macros/s/AKfycbz6DR8Q1sFG4CuZ0UtMn889EUQNQAUQjdDMbjt689wLfY45jWFvBkgkEKlgapYaQm1sIg/exec";

// 2. Definimos el tipo básico para extraer el slug
type ProductData = {
  slug?: string;
  [key: string]: unknown;
};

// 3. Esta función MÁGICA le dice a Next.js qué páginas estáticas generar
export async function generateStaticParams() {
  try {
    // Hacemos fetch a tu Excel durante el build
    const res = await fetch(SHEETS_ENDPOINT);
    const products: ProductData[] = await res.json();

    // Filtramos los que tienen slug y devolvemos el array de params
    return products
      .filter((p) => p.slug) // Solo productos con slug
      .map((p) => ({
        slug: p.slug, // Next.js generará una página por cada uno de estos
      }));
  } catch (error) {
    console.error("Error generando static params:", error);
    return []; // Si falla, no genera páginas de producto (evita romper el build completo)
  }
}

// 4. Tu componente de página normal
type Props = { params: Promise<{ slug: string }> }; // Next.js 15 usa Promise para params

export default async function ProductDetailRoute({ params }: Props) {
  // En Next.js 15, params es una promesa que debe resolverse
  const resolvedParams = await params;
  return <ProductDetail params={resolvedParams} />;
}