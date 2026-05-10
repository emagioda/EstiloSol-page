import type { MetadataRoute } from "next";

import { fetchProductsFromCatalogSource } from "@/src/server/catalog/source";

const baseUrl = () => process.env.APP_BASE_URL?.trim().replace(/\/$/, "") || "https://estilosol.ar";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();
  const staticRoutes: MetadataRoute.Sitemap = [
    {
      url: `${baseUrl()}/`,
      lastModified: now,
      changeFrequency: "weekly",
      priority: 1,
    },
    {
      url: `${baseUrl()}/tienda`,
      lastModified: now,
      changeFrequency: "daily",
      priority: 0.9,
    },
    {
      url: `${baseUrl()}/contacto`,
      lastModified: now,
      changeFrequency: "monthly",
      priority: 0.5,
    },
  ];

  try {
    const products = await fetchProductsFromCatalogSource();
    const productRoutes = products.map((product) => ({
      url: `${baseUrl()}/tienda/producto/${encodeURIComponent(String(product.slug || product.id))}`,
      lastModified: product.updated_at ? new Date(product.updated_at) : now,
      changeFrequency: "weekly" as const,
      priority: 0.7,
    }));

    return [...staticRoutes, ...productRoutes];
  } catch {
    return staticRoutes;
  }
}
