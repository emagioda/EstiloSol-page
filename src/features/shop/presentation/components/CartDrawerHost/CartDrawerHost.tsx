"use client";

import CartDrawer from "@/src/features/shop/presentation/components/CartDrawer/CartDrawer";
import { useCartDrawer } from "@/src/features/shop/presentation/view-models/useCartDrawer";

export default function CartDrawerHost() {
  const { open, setOpen } = useCartDrawer();

  return <CartDrawer open={open} onClose={() => setOpen(false)} />;
}
