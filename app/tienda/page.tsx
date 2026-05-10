import TiendaPage from "@/src/features/shop/presentation/pages/TiendaPage";

export const metadata = {
  title: "Tienda",
  description: "Catalogo de productos de peluqueria y bijouterie de Estilo Sol.",
  alternates: {
    canonical: "/tienda",
  },
  openGraph: {
    title: "Tienda Estilo Sol",
    description: "Productos profesionales de peluqueria y bijouterie seleccionados en Rosario.",
    url: "/tienda",
    images: ["/home/tienda-placeholder.webp"],
  },
};

export default function TiendaRoute() {
  return (
    <TiendaPage />
  );
}
