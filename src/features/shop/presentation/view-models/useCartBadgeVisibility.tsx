"use client";

import { createContext, useContext, useState } from "react";

type CartBadgeVisibilityContextValue = {
  suppressBadge: boolean;
  setSuppressBadge: (value: boolean) => void;
};

const CartBadgeVisibilityContext = createContext<CartBadgeVisibilityContextValue | undefined>(
  undefined
);

export const CartBadgeVisibilityProvider = ({
  children,
}: {
  children: React.ReactNode;
}) => {
  const [suppressBadge, setSuppressBadge] = useState(false);

  return (
    <CartBadgeVisibilityContext.Provider value={{ suppressBadge, setSuppressBadge }}>
      {children}
    </CartBadgeVisibilityContext.Provider>
  );
};

export const useCartBadgeVisibility = () => {
  const ctx = useContext(CartBadgeVisibilityContext);
  if (!ctx) {
    throw new Error("useCartBadgeVisibility must be used within a CartBadgeVisibilityProvider");
  }
  return ctx;
};
