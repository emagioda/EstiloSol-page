import type { Departament, Product } from "@/src/features/shop/domain/entities/Product";
import { Suspense } from "react";
import TiendaClientView from "./TiendaClientView";
import { fetchProductsFromCatalogSource } from "@/src/server/catalog/source";
import type { CatalogFacets, SpecFiltersMap } from "../view-models/useProductsStore";
import { getProductCategories } from "@/src/features/shop/domain/productCategories";

const INITIAL_PRODUCTS_COUNT = 24;

const sortProductsForInitialView = (products: Product[]) =>
  [...products].sort((a, b) => Number(Boolean(b.is_new)) - Number(Boolean(a.is_new)));

const normalizeSpecifications = (product: Product): Record<string, string> =>
  product.specifications && typeof product.specifications === "object"
    ? product.specifications
    : {};

const addSpecValue = (
  specSets: Record<string, Set<string>>,
  rawKey: string,
  rawValue: string,
) => {
  const key = rawKey.trim();
  const value = rawValue.trim();
  if (!key || !value) return;

  if (!specSets[key]) {
    specSets[key] = new Set<string>();
  }

  specSets[key].add(value);
};

const serializeSpecSets = (specSets: Record<string, Set<string>>): SpecFiltersMap =>
  Object.fromEntries(
    Object.entries(specSets)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([specKey, valuesSet]) => [
        specKey,
        Array.from(valuesSet).sort((left, right) => left.localeCompare(right)),
      ]),
  );

const buildCatalogFacets = (products: Product[]): CatalogFacets => {
  const emptyDepartment = () => ({
    categories: new Set<string>(),
    specifications: {} as Record<string, Set<string>>,
    specificationsByCategory: {} as Record<string, Record<string, Set<string>>>,
  });
  const workingFacets = {
    PELUQUERIA: emptyDepartment(),
    BIJOUTERIE: emptyDepartment(),
  } satisfies Record<Departament, ReturnType<typeof emptyDepartment>>;

  products.forEach((product) => {
    const departament =
      product.departament === "BIJOUTERIE" ? "BIJOUTERIE" : product.departament === "PELUQUERIA" ? "PELUQUERIA" : null;
    if (!departament) return;

    const departmentFacets = workingFacets[departament];
    const categories = getProductCategories(product);

    categories.forEach((category) => {
      departmentFacets.categories.add(category);
      if (!departmentFacets.specificationsByCategory[category]) {
        departmentFacets.specificationsByCategory[category] = {};
      }
    });

    Object.entries(normalizeSpecifications(product)).forEach(([specKey, specValue]) => {
      addSpecValue(departmentFacets.specifications, specKey, specValue);
      categories.forEach((category) => {
        addSpecValue(departmentFacets.specificationsByCategory[category], specKey, specValue);
      });
    });
  });

  return {
    PELUQUERIA: {
      categories: Array.from(workingFacets.PELUQUERIA.categories).sort((a, b) => a.localeCompare(b)),
      specifications: serializeSpecSets(workingFacets.PELUQUERIA.specifications),
      specificationsByCategory: Object.fromEntries(
        Object.entries(workingFacets.PELUQUERIA.specificationsByCategory)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([category, specSets]) => [category, serializeSpecSets(specSets)]),
      ),
    },
    BIJOUTERIE: {
      categories: Array.from(workingFacets.BIJOUTERIE.categories).sort((a, b) => a.localeCompare(b)),
      specifications: serializeSpecSets(workingFacets.BIJOUTERIE.specifications),
      specificationsByCategory: Object.fromEntries(
        Object.entries(workingFacets.BIJOUTERIE.specificationsByCategory)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([category, specSets]) => [category, serializeSpecSets(specSets)]),
      ),
    },
  };
};

export default async function TiendaPage({
  initialDepartament = "PELUQUERIA",
}: {
  initialDepartament?: Departament;
}) {
  let staticProducts: Product[] = [];

  try {
    staticProducts = await fetchProductsFromCatalogSource();
  } catch (error) {
    if (process.env.NODE_ENV !== "production") {
      console.error("No se pudieron cargar productos iniciales de tienda:", error);
    }
  }

  const initialProducts = sortProductsForInitialView(
    staticProducts.filter((product) => product.departament === initialDepartament),
  ).slice(0, INITIAL_PRODUCTS_COUNT);
  const initialFacets = buildCatalogFacets(staticProducts);

  return (
    <Suspense
      fallback={
        <main className="min-h-screen bg-[var(--brand-violet-950)]" aria-busy="true" />
      }
    >
      <TiendaClientView
        initialProducts={initialProducts}
        initialCatalogComplete={staticProducts.length <= initialProducts.length}
        initialDepartament={initialDepartament}
        initialFacets={initialFacets}
      />
    </Suspense>
  );
}
