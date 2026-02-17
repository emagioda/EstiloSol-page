import CartDrawerHost from "@/src/features/shop/presentation/components/CartDrawerHost/CartDrawerHost";

export default function TiendaLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <CartDrawerHost />
    </>
  );
}
