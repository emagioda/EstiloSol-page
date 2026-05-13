"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { prefetchProductsCatalogSession } from "@/src/features/shop/presentation/view-models/useProductsStore";

export default function HomeCatalogPrefetch() {
  const router = useRouter();

  useEffect(() => {
    void router.prefetch("/tienda");

    const prefetchTimer = window.setTimeout(() => {
      void prefetchProductsCatalogSession();
    }, 300);

    return () => {
      window.clearTimeout(prefetchTimer);
    };
  }, [router]);

  return null;
}
