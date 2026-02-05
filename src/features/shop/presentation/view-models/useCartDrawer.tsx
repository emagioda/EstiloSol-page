"use client";
import React, { createContext, useContext, useState } from "react";

type CartDrawerContextValue = {
  open: boolean;
  setOpen: (open: boolean) => void;
};

const CartDrawerContext = createContext<CartDrawerContextValue | undefined>(undefined);

export const CartDrawerProvider = ({ children }: { children: React.ReactNode }) => {
  const [open, setOpen] = useState(false);

  return (
    <CartDrawerContext.Provider value={{ open, setOpen }}>
      {children}
    </CartDrawerContext.Provider>
  );
};

export const useCartDrawer = () => {
  const ctx = useContext(CartDrawerContext);
  if (!ctx) {
    throw new Error("useCartDrawer must be used within a CartDrawerProvider");
  }
  return ctx;
};
