"use client";

import { toast } from "sonner";
import CartAddedToast from "@/src/features/shop/presentation/components/CartAddedToast/CartAddedToast";

type ShowCartAddedToastParams = {
  productName: string;
  image?: string;
  onViewCart: () => void;
};

export function showCartAddedToast({ productName, image, onViewCart }: ShowCartAddedToastParams) {
  toast.custom(
    (toastId) => (
      <CartAddedToast
        productName={productName}
        image={image}
        onViewCart={() => {
          toast.dismiss(toastId);
          onViewCart();
        }}
      />
    ),
    {
      duration: 4000,
    }
  );
}
