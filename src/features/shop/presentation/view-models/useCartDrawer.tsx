"use client";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

const CART_DRAWER_HISTORY_KEY = "__estiloSolCartDrawerOpen";

type SetCartDrawerOpenOptions = {
  skipHistoryBack?: boolean;
};

type CartDrawerContextValue = {
  open: boolean;
  setOpen: (open: boolean, options?: SetCartDrawerOpenOptions) => void;
};

const CartDrawerContext = createContext<CartDrawerContextValue | undefined>(undefined);

const pushCartDrawerHistoryEntry = () => {
  if (typeof window === "undefined") return false;

  try {
    const currentState = window.history.state;
    const nextState =
      currentState && typeof currentState === "object"
        ? {
            ...(currentState as Record<string, unknown>),
            [CART_DRAWER_HISTORY_KEY]: true,
          }
        : { [CART_DRAWER_HISTORY_KEY]: true };

    window.history.pushState(nextState, "", window.location.href);
    return true;
  } catch {
    return false;
  }
};

const clearCartDrawerHistoryMarker = () => {
  if (typeof window === "undefined") return;

  try {
    const currentState = window.history.state;
    if (!currentState || typeof currentState !== "object") return;

    const currentRecord = currentState as Record<string, unknown>;
    if (!currentRecord[CART_DRAWER_HISTORY_KEY]) return;

    const nextState = { ...currentRecord };
    delete nextState[CART_DRAWER_HISTORY_KEY];
    window.history.replaceState(nextState, "", window.location.href);
  } catch {
    return;
  }
};

const isCartDrawerHistoryState = () => {
  if (typeof window === "undefined") return false;

  const currentState = window.history.state;
  return Boolean(
    currentState &&
      typeof currentState === "object" &&
      (currentState as Record<string, unknown>)[CART_DRAWER_HISTORY_KEY]
  );
};

export const CartDrawerProvider = ({ children }: { children: React.ReactNode }) => {
  const [open, setOpenState] = useState(false);
  const openRef = useRef(false);
  const historyEntryRef = useRef(false);

  useEffect(() => {
    openRef.current = open;
  }, [open]);

  const setOpen = useCallback(
    (nextOpen: boolean, options: SetCartDrawerOpenOptions = {}) => {
      if (nextOpen) {
        setOpenState(true);

        if (!historyEntryRef.current && pushCartDrawerHistoryEntry()) {
          historyEntryRef.current = true;
        }
        return;
      }

      setOpenState(false);

      if (!historyEntryRef.current) return;

      if (options.skipHistoryBack) {
        historyEntryRef.current = false;
        clearCartDrawerHistoryMarker();
        return;
      }

      if (typeof window === "undefined") return;
      historyEntryRef.current = false;
      window.history.back();
    },
    []
  );

  useEffect(() => {
    const onPopState = () => {
      if (isCartDrawerHistoryState()) {
        historyEntryRef.current = true;
        setOpenState(true);
        return;
      }

      if (!historyEntryRef.current && !openRef.current) return;

      historyEntryRef.current = false;
      setOpenState(false);
    };

    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

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
