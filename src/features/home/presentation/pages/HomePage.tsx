import HomeSplit from "@/src/features/home/presentation/components/HomeSplit/HomeSplit";
import HomeCatalogPrefetch from "@/src/features/home/presentation/components/HomeCatalogPrefetch/HomeCatalogPrefetch";

export default function HomePage() {
  return (
    <div className="flex flex-1 flex-col">
      <HomeCatalogPrefetch />
      <div className="sr-only">
        <h1>Estilo Sol | Estilo y Cuidado</h1>
        <p>
          Productos Profesionales y Diseños Únicos para Peluquería y
          Bijouterie en un solo lugar.
        </p>
      </div>
      <HomeSplit />
    </div>
  );
}
