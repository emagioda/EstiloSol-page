import type { Metadata } from "next";
import { notFound } from "next/navigation";

import ProductDetail from "@/src/features/shop/presentation/pages/ProductDetail";
import type { Product } from "@/src/features/shop/domain/entities/Product";
import { fetchProductsFromCatalogSource } from "@/src/server/catalog/source";

export const dynamicParams = true;

type Props = { params: Promise<{ slug: string }> };

const baseUrl = () => process.env.APP_BASE_URL?.trim() || "https://estilosol.ar";

const findProductBySlugOrId = (products: Product[], slugParam: string) => {
  const decodedSlug = decodeURIComponent(slugParam);
  return products.find(
    (product) => product.slug === decodedSlug || String(product.id) === decodedSlug,
  );
};

const loadProduct = async (slug: string): Promise<Product | undefined> => {
  const products = await fetchProductsFromCatalogSource();
  return findProductBySlugOrId(products, slug);
};

const productUrl = (product: Product) => {
  const handle = product.slug || product.id;
  return `${baseUrl()}/tienda/producto/${encodeURIComponent(String(handle))}`;
};

const availabilityForSchema = (product: Product) => {
  if (product.stock_status === "out_of_stock") return "https://schema.org/OutOfStock";
  if (product.stock_status === "preorder") return "https://schema.org/PreOrder";
  return "https://schema.org/InStock";
};

const escapeJsonForHtml = (value: unknown) => JSON.stringify(value).replace(/</g, "\\u003c");

export async function generateStaticParams() {
  try {
    const products = await fetchProductsFromCatalogSource();
    return products
      .map((product) => String(product.slug || product.id).trim())
      .filter(Boolean)
      .map((slug) => ({ slug }));
  } catch (error) {
    console.error("Error generando rutas estaticas de productos:", error);
    return [];
  }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;

  try {
    const product = await loadProduct(slug);
    if (!product) {
      return {
        title: "Producto no encontrado | Estilo Sol",
        robots: { index: false, follow: true },
      };
    }

    const title = `${product.name} | Estilo Sol`;
    const description =
      product.short_description || product.description || "Producto de peluqueria y bijouterie en Estilo Sol.";
    const images = product.images?.slice(0, 4);

    return {
      title,
      description,
      alternates: {
        canonical: productUrl(product),
      },
      openGraph: {
        title,
        description,
        type: "website",
        url: productUrl(product),
        images,
      },
      twitter: {
        card: "summary_large_image",
        title,
        description,
        images,
      },
    };
  } catch {
    return {
      title: "Producto | Estilo Sol",
      description: "Producto de peluqueria y bijouterie en Estilo Sol.",
    };
  }
}

export default async function ProductDetailRoute({ params }: Props) {
  const resolvedParams = await params;
  let product: Product | undefined;

  try {
    product = await loadProduct(resolvedParams.slug);
  } catch (error) {
    console.error("Error obteniendo producto:", error);
  }

  if (!product) {
    notFound();
  }

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.name,
    description: product.short_description || product.description || product.name,
    image: product.images || [],
    sku: product.id,
    url: productUrl(product),
    brand: {
      "@type": "Brand",
      name: "Estilo Sol",
    },
    offers: {
      "@type": "Offer",
      priceCurrency: product.currency || "ARS",
      price: product.price,
      availability: availabilityForSchema(product),
      url: productUrl(product),
    },
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: escapeJsonForHtml(jsonLd) }}
      />
      <ProductDetail product={product} slug={resolvedParams.slug} />
    </>
  );
}
