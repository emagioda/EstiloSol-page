"use client";

import dynamic from "next/dynamic";
import { useCartDrawer } from "@/src/features/shop/presentation/view-models/useCartDrawer";

const CartDrawer = dynamic(
  () => import("@/src/features/shop/presentation/components/CartDrawer/CartDrawer"),
  { ssr: false },
);

export default function CartDrawerHost() {
  const { open, setOpen } = useCartDrawer();

  return <CartDrawer open={open} onClose={() => setOpen(false)} />;
}
