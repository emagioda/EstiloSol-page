"use client";

import { Toaster } from "sonner";

export default function AppToaster() {
  return (
    <Toaster
      position="top-right"
      expand={false}
      closeButton={false}
      richColors
      offset={{
        top: "calc(var(--header-height-desktop) + 12px)",
        right: "max(12px, env(safe-area-inset-right, 0px))",
      }}
      mobileOffset={{
        top: "calc(var(--header-height-mobile) + 10px)",
        right: "max(10px, env(safe-area-inset-right, 0px))",
      }}
      toastOptions={{
        duration: 4000,
      }}
    />
  );
}
