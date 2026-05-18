import type { Departament } from "@/src/features/shop/domain/entities/Product";
import TiendaClientView from "./TiendaClientView";

export default function TiendaPage({
  initialDepartament = "PELUQUERIA",
}: {
  initialDepartament?: Departament;
}) {
  return (
    <TiendaClientView
      initialProducts={[]}
      initialCatalogComplete={false}
      initialDepartament={initialDepartament}
    />
  );
}
