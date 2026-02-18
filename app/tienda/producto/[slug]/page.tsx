import ProductDetailClientPage from "./ProductDetailClientPage";

// URL to fetch products from Google Apps Script
const SHEETS_URL = "https://script.google.com/macros/s/AKfycbz6DR8Q1sFG4CuZ0UtMn889EUQNQAUQjdDMbjt689wLfY45jWFvBkgkEKlgapYaQm1sIg/exec";

/**
 * Generate static params for product detail pages.
 * This fetches the complete product catalog at build time and extracts the slug for each product.
 */
export async function generateStaticParams() {
  try {
    const products: Array<{ slug: string }> = await fetch(SHEETS_URL).then((res) => res.json());
    return products.map((product) => ({ slug: product.slug }));
  } catch (error) {
    console.error("Error fetching products for generateStaticParams", error);
    return [];
  }
}

// Props for the product detail page
interface Props {
  params: {
    slug: string;
  };
}

/**
 * Product detail page. Renders the client component for a given slug.
 */
export default function ProductDetailPage({ params }: Props) {
  const { slug } = params;
  return <ProductDetailClientPage slug={slug} />;
}
