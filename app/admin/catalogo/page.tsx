import { updateCatalogProductAction } from "@/app/admin/actions";
import type { AdminProductSheetRow } from "@/src/server/sheets/repository";
import { getProductsForAdmin } from "@/src/server/sheets/repository";

export const dynamic = "force-dynamic";

type CatalogSort = "id" | "name" | "price" | "active";

const SORT_OPTIONS: Array<{ value: CatalogSort; label: string }> = [
  { value: "id", label: "ID (alfabetico)" },
  { value: "name", label: "Nombre (A-Z)" },
  { value: "price", label: "Precio (menor a mayor)" },
  { value: "active", label: "Estado activo (activos primero)" },
];

const dateFormatter = new Intl.DateTimeFormat("es-AR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

const formatDate = (value: string) => {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return dateFormatter.format(date);
};

const parseSort = (value: unknown): CatalogSort => {
  if (value === "id" || value === "name" || value === "price" || value === "active") {
    return value;
  }
  return "name";
};

const sortProducts = (products: AdminProductSheetRow[], sortBy: CatalogSort) => {
  const list = [...products];

  list.sort((a, b) => {
    if (sortBy === "id") {
      return a.id.localeCompare(b.id, "es", { sensitivity: "base" });
    }

    if (sortBy === "name") {
      return a.name.localeCompare(b.name, "es", { sensitivity: "base" });
    }

    if (sortBy === "price") {
      if (a.price !== b.price) return a.price - b.price;
      return a.name.localeCompare(b.name, "es", { sensitivity: "base" });
    }

    if (a.active !== b.active) {
      return Number(b.active) - Number(a.active);
    }
    return a.name.localeCompare(b.name, "es", { sensitivity: "base" });
  });

  return list;
};

function CatalogTable({
  title,
  products,
}: {
  title: string;
  products: AdminProductSheetRow[];
}) {
  return (
    <section className="rounded-2xl border border-[var(--brand-gold-300)]/22 bg-[rgba(255,255,255,0.07)] p-4 shadow-[0_14px_26px_rgba(9,4,19,0.24)]">
      <div className="mb-4 flex items-center justify-between gap-2">
        <h3 className="[font-family:var(--font-brand-display)] text-2xl text-[var(--brand-cream)]">{title}</h3>
        <span className="rounded-full border border-[var(--brand-gold-300)]/35 bg-[rgba(248,227,176,0.1)] px-2.5 py-1 text-xs font-semibold text-[var(--brand-cream)]">
          {products.length} productos
        </span>
      </div>

      {products.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-[var(--brand-gold-300)]/30 px-4 py-6 text-center text-sm text-[var(--brand-cream)]/78">
          No hay productos para este rubro.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-[var(--brand-gold-300)]/25 bg-white">
          <table className="min-w-[920px] w-full text-left">
            <thead className="bg-[var(--brand-violet-900)] text-[var(--brand-cream)]">
              <tr className="text-xs uppercase tracking-[0.1em]">
                <th className="px-3 py-2.5">Activo</th>
                <th className="px-3 py-2.5">ID</th>
                <th className="px-3 py-2.5">Producto</th>
                <th className="px-3 py-2.5">Precio</th>
                <th className="px-3 py-2.5">Actualizado</th>
                <th className="px-3 py-2.5">Accion</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--brand-violet-700)]/12 bg-white text-[13px] text-slate-900">
              {products.map((product) => {
                const formId = `product-form-${title}-${product.id}`;
                return (
                  <tr key={product.id} className="align-top">
                    <td className="px-3 py-2.5">
                      <input
                        form={formId}
                        type="checkbox"
                        name="active"
                        defaultChecked={product.active}
                        className="h-4 w-4"
                        aria-label={`Activo ${product.name}`}
                      />
                    </td>
                    <td className="px-3 py-2.5 font-medium">{product.id}</td>
                    <td className="px-3 py-2.5">
                      <input
                        form={formId}
                        type="text"
                        name="name"
                        defaultValue={product.name}
                        className="w-full min-w-[240px] rounded-lg border border-slate-300 px-2 py-1.5 text-xs text-slate-900"
                        required
                      />
                    </td>
                    <td className="px-3 py-2.5">
                      <input
                        form={formId}
                        type="number"
                        name="price"
                        min={0}
                        step="1"
                        defaultValue={Math.round(product.price)}
                        className="w-28 rounded-lg border border-slate-300 px-2 py-1.5 text-xs text-slate-900"
                        required
                      />
                    </td>
                    <td className="px-3 py-2.5 text-slate-700">{formatDate(product.updatedAt)}</td>
                    <td className="px-3 py-2.5">
                      <form id={formId} action={updateCatalogProductAction}>
                        <input type="hidden" name="productId" value={product.id} />
                        <input type="hidden" name="redirectTo" value="/admin/catalogo" />
                        <button
                          type="submit"
                          className="rounded-lg bg-[var(--brand-gold-300)] px-2 py-1.5 text-xs font-semibold text-[var(--brand-violet-950)] transition hover:brightness-105"
                        >
                          Guardar
                        </button>
                      </form>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

type AdminCatalogoPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>> | Record<string, string | string[] | undefined>;
};

export default async function AdminCatalogoPage({ searchParams }: AdminCatalogoPageProps) {
  const resolvedSearchParams = searchParams ? await searchParams : {};
  const sortParam = Array.isArray(resolvedSearchParams.sort)
    ? resolvedSearchParams.sort[0]
    : resolvedSearchParams.sort;
  const selectedSort = parseSort(sortParam);

  const products = await getProductsForAdmin();
  const peluqueriaProducts = sortProducts(
    products.filter((product) => product.departament === "PELUQUERIA"),
    selectedSort
  );
  const bijouterieProducts = sortProducts(
    products.filter((product) => product.departament === "BIJOUTERIE"),
    selectedSort
  );

  return (
    <div className="flex flex-col gap-5">
      <header className="glass-panel rounded-3xl border border-[var(--brand-gold-300)]/25 p-5 shadow-[0_20px_42px_rgba(11,4,24,0.35)]">
        <h2 className="[font-family:var(--font-brand-display)] text-3xl text-[var(--brand-cream)]">Catalogo</h2>
        <p className="mt-1 text-sm text-[var(--brand-cream)]/75">
          Gestiona productos separados por rubro. Los productos sin rubro valido no se muestran.
        </p>
        <form method="GET" className="mt-4 flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-xs font-semibold uppercase tracking-[0.1em] text-[var(--brand-cream)]/85">
            Ordenar por
            <select
              name="sort"
              defaultValue={selectedSort}
              className="min-w-[240px] rounded-lg border border-[var(--brand-gold-300)]/45 bg-white px-2.5 py-2 text-sm font-normal text-slate-900"
            >
              {SORT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <button
            type="submit"
            className="rounded-lg border border-[var(--brand-gold-300)]/45 bg-[rgba(248,227,176,0.16)] px-3 py-2 text-xs font-semibold uppercase tracking-[0.1em] text-[var(--brand-cream)] transition hover:bg-[rgba(248,227,176,0.3)]"
          >
            Aplicar
          </button>
        </form>
      </header>

      <CatalogTable title="Peluqueria" products={peluqueriaProducts} />
      <CatalogTable title="Bijouterie" products={bijouterieProducts} />
    </div>
  );
}
