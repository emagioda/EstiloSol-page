"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { prefetchProductsCatalogSession } from "@/src/features/shop/presentation/view-models/useProductsStore";

export default function HomeCatalogPrefetch() {
  const router = useRouter();

  useEffect(() => {
    void prefetchProductsCatalogSession();
    void router.prefetch("/tienda");
  }, [router]);

  return null;
}
