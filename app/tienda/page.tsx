import TiendaPage from "@/src/features/shop/presentation/pages/TiendaPage";
import type { Departament } from "@/src/features/shop/domain/entities/Product";

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

type TiendaRouteProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

const normalizeRubroParam = (value: string | string[] | undefined): Departament | undefined => {
  const rawValue = Array.isArray(value) ? value[0] : value;
  if (!rawValue) return undefined;

  const normalized = rawValue
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();

  return normalized === "BIJOUTERIE" || normalized === "PELUQUERIA"
    ? normalized
    : undefined;
};

export default async function TiendaRoute({ searchParams }: TiendaRouteProps) {
  const params = searchParams ? await searchParams : undefined;
  const initialDepartament = normalizeRubroParam(params?.rubro);

  return (
    <TiendaPage initialDepartament={initialDepartament} />
  );
}
