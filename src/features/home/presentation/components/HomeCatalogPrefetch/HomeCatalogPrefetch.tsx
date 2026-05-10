"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function HomeCatalogPrefetch() {
  const router = useRouter();

  useEffect(() => {
    void router.prefetch("/tienda");
  }, [router]);

  return null;
}
