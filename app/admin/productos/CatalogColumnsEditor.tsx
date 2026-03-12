"use client";

import { useEffect, useMemo, useState } from "react";
import { updateCatalogProductAction } from "@/app/admin/actions";
import { useBodyScrollLock } from "@/src/core/presentation/hooks/useBodyScrollLock";
import type { AdminProductSheetRow } from "@/src/server/sheets/repository";

type CatalogColumnsEditorProps = {
  peluqueriaProducts: AdminProductSheetRow[];
  bijouterieProducts: AdminProductSheetRow[];
};

const listToMultiline = (items: string[]) => items.join("\n");

function CatalogColumn({
  title,
  products,
  onEdit,
  withDivider = false,
}: {
  title: string;
  products: AdminProductSheetRow[];
  onEdit: (product: AdminProductSheetRow) => void;
  withDivider?: boolean;
}) {
  const [query, setQuery] = useState("");
  const filteredProducts = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("es");
    if (!normalized) return products;
    return products.filter((product) =>
      product.name.toLocaleLowerCase("es").includes(normalized)
    );
  }, [products, query]);

  return (
    <section
      className={`flex flex-col ${
        withDivider
          ? "pb-6 border-b border-[var(--brand-gold-300)]/28 xl:pb-0 xl:pr-7 xl:border-b-0 xl:border-r"
          : ""
      }`}
    >
      <div className="mb-4 flex items-center justify-between gap-2">
        <h3 className="[font-family:var(--font-brand-display)] text-2xl uppercase tracking-[0.08em] text-[var(--brand-cream)]">
          {title}
        </h3>
        <span className="rounded-full border border-[var(--brand-gold-300)]/35 bg-[rgba(248,227,176,0.1)] px-2.5 py-1 text-xs font-semibold text-[var(--brand-cream)]">
          {filteredProducts.length}/{products.length}
        </span>
      </div>

      <label className="mb-3 flex items-center gap-2 rounded-lg border border-[var(--brand-gold-300)]/35 bg-[rgba(255,255,255,0.14)] px-3 py-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.22)]">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden
          className="h-4 w-4 text-[var(--brand-gold-300)]"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Buscar producto por nombre"
          className="w-full bg-transparent text-sm text-[var(--brand-cream)] placeholder:text-[var(--brand-cream)]/78 focus:outline-none"
          aria-label={`Buscar producto por nombre en ${title}`}
        />
      </label>

      {filteredProducts.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-[var(--brand-gold-300)]/30 px-4 py-6 text-center text-sm text-[var(--brand-cream)]/78">
          {products.length === 0
            ? "No hay productos para este rubro."
            : "No hay productos que coincidan con la búsqueda."}
        </p>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-[var(--brand-gold-300)]/25 bg-white shadow-[0_16px_30px_rgba(12,6,24,0.25)]">
          <div className="grid grid-cols-[22px_24px_minmax(0,1fr)_66px] items-center gap-1 bg-[var(--brand-violet-900)] px-2.5 py-2 text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--brand-cream)]">
            <span aria-hidden />
            <span className="text-center">ID</span>
            <span>Nombre</span>
            <span className="text-center">Acción</span>
          </div>
          <ul className="divide-y divide-[var(--brand-violet-700)]/12">
            {filteredProducts.map((product) => (
              <li
                key={product.id}
                className="group grid grid-cols-[22px_24px_minmax(0,1fr)_66px] items-center gap-1 px-2.5 py-2.5 text-slate-900 transition-colors duration-150 hover:bg-[rgba(92,54,150,0.08)]"
              >
                <div className="flex justify-center">
                  <input
                    type="checkbox"
                    checked={product.active}
                    readOnly
                    className="h-4 w-4"
                    aria-label={`Producto activo: ${product.name}`}
                  />
                </div>
                <p className="text-center font-mono text-xs font-semibold">{product.id}</p>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium transition-colors group-hover:text-[var(--brand-violet-950)]">
                    {product.name}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => onEdit(product)}
                  className="justify-self-center rounded-lg bg-[var(--brand-gold-300)] px-2 py-1 text-[11px] font-semibold text-[var(--brand-violet-950)] transition hover:brightness-105"
                >
                  Editar
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

export default function CatalogColumnsEditor({
  peluqueriaProducts,
  bijouterieProducts,
}: CatalogColumnsEditorProps) {
  const [editingProduct, setEditingProduct] = useState<AdminProductSheetRow | null>(null);
  const [isSavingProduct, setIsSavingProduct] = useState(false);
  const hasModalOpen = Boolean(editingProduct);
  const openProductEditor = (product: AdminProductSheetRow) => {
    setIsSavingProduct(false);
    setEditingProduct(product);
  };
  const closeProductEditor = () => {
    if (isSavingProduct) return;
    setIsSavingProduct(false);
    setEditingProduct(null);
  };
  const includesValue = useMemo(
    () => (editingProduct ? listToMultiline(editingProduct.includes) : ""),
    [editingProduct]
  );
  const imagesValue = useMemo(
    () => (editingProduct ? listToMultiline(editingProduct.images) : ""),
    [editingProduct]
  );

  useBodyScrollLock(hasModalOpen || isSavingProduct);

  useEffect(() => {
    if (!hasModalOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (isSavingProduct) return;
      if (event.key === "Escape") {
        event.preventDefault();
        setIsSavingProduct(false);
        setEditingProduct(null);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [hasModalOpen, isSavingProduct]);

  return (
    <>
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2 xl:gap-8">
        <CatalogColumn
          title="PELUQUERÍA"
          products={peluqueriaProducts}
          onEdit={openProductEditor}
          withDivider
        />
        <CatalogColumn title="BIJOUTERIE" products={bijouterieProducts} onEdit={openProductEditor} />
      </div>

      {editingProduct ? (
        <div className="fixed inset-0 z-[260] flex items-center justify-center bg-black/60 p-4">
          <div
            className="absolute inset-0"
            onClick={() => {
              if (isSavingProduct) return;
              closeProductEditor();
            }}
            aria-hidden
          />

          <form
            key={editingProduct.id}
            action={updateCatalogProductAction}
            onSubmit={() => setIsSavingProduct(true)}
            className={`relative z-10 max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-[var(--brand-gold-300)]/35 bg-[var(--brand-violet-950)] p-5 text-[var(--brand-cream)] shadow-[0_24px_52px_rgba(4,2,10,0.55)] ${
              isSavingProduct ? "pointer-events-none opacity-85" : ""
            }`}
          >
            <input type="hidden" name="productId" value={editingProduct.id} />
            <input type="hidden" name="productType" value={editingProduct.productType} />
            <input type="hidden" name="redirectTo" value="/admin/productos" />

            <div className="mb-4 flex items-start justify-between gap-3 border-b border-[var(--brand-gold-300)]/20 pb-4">
              <div>
                <p className="text-xs uppercase tracking-[0.12em] text-[var(--brand-gold-300)]/85">Editar producto</p>
                <h3 className="[font-family:var(--font-brand-display)] text-2xl">{editingProduct.name}</h3>
                <p className="mt-1 text-xs text-[var(--brand-cream)]/70">
                  ID: {editingProduct.id} | Rubro: {editingProduct.departament || "Sin rubro"}
                </p>
              </div>
              <button
                type="button"
                onClick={closeProductEditor}
                disabled={isSavingProduct}
                className="rounded-full border border-[var(--brand-gold-300)]/35 px-3 py-1 text-sm transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-60"
                aria-label="Cerrar modal de edición"
              >
                Cerrar
              </button>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <label className="flex items-center gap-2 rounded-xl border border-[var(--brand-gold-300)]/25 bg-white/5 px-3 py-2 text-sm">
                <input
                  type="checkbox"
                  name="active"
                  defaultChecked={editingProduct.active}
                  className="h-4 w-4"
                />
                Activo
              </label>

              <label className="flex flex-col gap-1 text-xs font-semibold uppercase tracking-[0.08em] text-[var(--brand-cream)]/80">
                ¿Es nuevo?
                <select
                  name="isNew"
                  defaultValue={editingProduct.isNew ? "true" : "false"}
                  className="rounded-lg border border-[var(--brand-gold-300)]/30 bg-white px-2.5 py-2 text-sm font-normal text-slate-900"
                >
                  <option value="false">No</option>
                  <option value="true">Sí</option>
                </select>
              </label>

              <label className="md:col-span-2 flex flex-col gap-1 text-xs font-semibold uppercase tracking-[0.08em] text-[var(--brand-cream)]/80">
                Nombre
                <input
                  name="name"
                  type="text"
                  required
                  defaultValue={editingProduct.name}
                  className="rounded-lg border border-[var(--brand-gold-300)]/30 bg-white px-2.5 py-2 text-sm font-normal text-slate-900"
                />
              </label>

              <label className="flex flex-col gap-1 text-xs font-semibold uppercase tracking-[0.08em] text-[var(--brand-cream)]/80">
                Precio
                <input
                  name="price"
                  type="number"
                  min={0}
                  step="1"
                  required
                  defaultValue={Math.round(editingProduct.price)}
                  className="rounded-lg border border-[var(--brand-gold-300)]/30 bg-white px-2.5 py-2 text-sm font-normal text-slate-900"
                />
              </label>

              <label className="md:col-span-2 flex flex-col gap-1 text-xs font-semibold uppercase tracking-[0.08em] text-[var(--brand-cream)]/80">
                Descripción corta
                <textarea
                  name="shortDescription"
                  rows={3}
                  defaultValue={editingProduct.shortDescription}
                  className="rounded-lg border border-[var(--brand-gold-300)]/30 bg-white px-2.5 py-2 text-sm font-normal text-slate-900"
                />
              </label>

              <label className="md:col-span-2 flex flex-col gap-1 text-xs font-semibold uppercase tracking-[0.08em] text-[var(--brand-cream)]/80">
                Descripción larga
                <textarea
                  name="description"
                  rows={8}
                  defaultValue={editingProduct.description}
                  className="rounded-lg border border-[var(--brand-gold-300)]/30 bg-white px-2.5 py-2 text-sm font-normal text-slate-900"
                />
              </label>

              {editingProduct.productType === "KIT" ? (
                <label className="md:col-span-2 flex flex-col gap-1 text-xs font-semibold uppercase tracking-[0.08em] text-[var(--brand-cream)]/80">
                  Incluye (uno por línea)
                  <textarea
                    name="includes"
                    rows={4}
                    defaultValue={includesValue}
                    className="rounded-lg border border-[var(--brand-gold-300)]/30 bg-white px-2.5 py-2 text-sm font-normal text-slate-900"
                  />
                </label>
              ) : (
                <input type="hidden" name="includes" value="" />
              )}

              <label className="md:col-span-2 flex flex-col gap-1 text-xs font-semibold uppercase tracking-[0.08em] text-[var(--brand-cream)]/80">
                Enlaces de imágenes (uno por línea)
                <textarea
                  name="images"
                  rows={5}
                  defaultValue={imagesValue}
                  className="rounded-lg border border-[var(--brand-gold-300)]/30 bg-white px-2.5 py-2 text-sm font-normal text-slate-900"
                />
              </label>
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={closeProductEditor}
                disabled={isSavingProduct}
                className="rounded-lg border border-[var(--brand-gold-300)]/35 px-3 py-2 text-xs font-semibold uppercase tracking-[0.08em] text-[var(--brand-cream)] transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={isSavingProduct}
                className="rounded-lg bg-[var(--brand-gold-300)] px-3 py-2 text-xs font-semibold uppercase tracking-[0.08em] text-[var(--brand-violet-950)] transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-70"
              >
                {isSavingProduct ? "Guardando..." : "Guardar cambios"}
              </button>
            </div>
          </form>

          {isSavingProduct ? (
            <div className="fixed inset-0 z-[280] flex items-center justify-center bg-[rgba(10,5,20,0.74)] p-4">
              <div className="w-full max-w-sm rounded-2xl border border-[var(--brand-gold-300)]/35 bg-[var(--brand-violet-950)] p-5 text-center text-[var(--brand-cream)] shadow-[0_22px_46px_rgba(4,2,10,0.55)]">
                <span
                  className="mx-auto inline-flex h-10 w-10 animate-spin items-center justify-center rounded-full border-2 border-[var(--brand-gold-300)]/40 border-t-[var(--brand-gold-300)]"
                  aria-hidden
                />
                <p className="mt-3 [font-family:var(--font-brand-display)] text-2xl">Guardando producto</p>
                <p className="mt-1 text-sm text-[var(--brand-cream)]/82">
                  Estamos actualizando la información.
                </p>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

