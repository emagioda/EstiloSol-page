"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  clearShopFiltersSessionState,
  prefetchProductsCatalogSession,
} from "@/src/features/shop/presentation/view-models/useProductsStore";

export default function HomeCatalogPrefetch() {
  const router = useRouter();

  useEffect(() => {
    clearShopFiltersSessionState();
    void router.prefetch("/tienda");
    void prefetchProductsCatalogSession();
  }, [router]);

  return null;
}
