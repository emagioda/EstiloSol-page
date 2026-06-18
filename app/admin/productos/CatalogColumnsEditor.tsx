"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import { updateCatalogProductAction } from "@/app/admin/actions";
import { useBodyScrollLock } from "@/src/core/presentation/hooks/useBodyScrollLock";
import type { AdminProductSheetRow } from "@/src/server/sheets/repository";

type CatalogColumnsEditorProps = {
  peluqueriaProducts: AdminProductSheetRow[];
  bijouterieProducts: AdminProductSheetRow[];
};

type DepartmentTab = "peluqueria" | "bijouterie";
type SortKey = "active" | "id" | "name" | "stock";
type SortDirection = "asc" | "desc";

const listToMultiline = (items: string[]) => items.join("\n");

const stockStatusLabels = {
  in_stock: "Con stock",
  out_of_stock: "Sin stock",
  preorder: "Preventa",
} as const;

const sortOptions: Array<{ key: SortKey; label: string }> = [
  { key: "name", label: "Nombre" },
  { key: "id", label: "ID" },
  { key: "stock", label: "Stock" },
  { key: "active", label: "Activo" },
];

const productMatchesQuery = (product: AdminProductSheetRow, query: string) => {
  const normalized = query.trim().toLocaleLowerCase("es");
  if (!normalized) return true;

  return [product.name, product.id].some((value) =>
    value.toLocaleLowerCase("es").includes(normalized)
  );
};

const stockValue = (product: AdminProductSheetRow) =>
  product.stockQty === null ? stockStatusLabels[product.stockStatus] : product.stockQty;

const isOutOfStock = (product: AdminProductSheetRow) =>
  product.stockQty === null ? product.stockStatus === "out_of_stock" : product.stockQty <= 0;

const compareProducts = (a: AdminProductSheetRow, b: AdminProductSheetRow, key: SortKey) => {
  if (key === "active") {
    if (a.active === b.active) return 0;
    return a.active ? -1 : 1;
  }

  if (key === "id") {
    return a.id.localeCompare(b.id, "es", { numeric: true, sensitivity: "base" });
  }

  if (key === "name") {
    return a.name.localeCompare(b.name, "es", { sensitivity: "base" });
  }

  const aStock = stockValue(a);
  const bStock = stockValue(b);
  if (typeof aStock === "number" && typeof bStock === "number") {
    return aStock - bStock;
  }

  return String(aStock).localeCompare(String(bStock), "es", {
    numeric: true,
    sensitivity: "base",
  });
};

const sortProducts = (
  products: AdminProductSheetRow[],
  sortKey: SortKey,
  sortDirection: SortDirection
) => {
  const sorted = [...products].sort((a, b) => compareProducts(a, b, sortKey));
  return sortDirection === "asc" ? sorted : sorted.reverse();
};

function PencilIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
      className={className}
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}

function ActiveIndicator({
  product,
  compact = false,
}: {
  product: AdminProductSheetRow;
  compact?: boolean;
}) {
  return (
    <label
      className={`relative inline-flex items-center justify-center rounded-full border border-[#d8cce4] bg-white shadow-[0_1px_4px_rgba(45,22,75,0.12)] ${
        compact ? "h-8 w-8" : "h-9 w-9"
      }`}
      title={product.active ? "Activo" : "Inactivo"}
    >
      <input
        type="checkbox"
        checked={product.active}
        readOnly
        className="sr-only"
        aria-label={`${product.name}: ${product.active ? "activo" : "inactivo"}`}
      />
      <span
        className={`flex h-5 w-5 items-center justify-center rounded-md border transition ${
          product.active
            ? "border-[var(--brand-violet-700)] bg-[var(--brand-violet-700)] text-white"
            : "border-[#cbb9dc] bg-[#f6effb]"
        }`}
        aria-hidden
      >
        {product.active ? (
          <svg
            viewBox="0 0 24 24"
            fill="none"
            className="h-3.5 w-3.5"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="m5 12 4 4L19 6" />
          </svg>
        ) : null}
      </span>
    </label>
  );
}

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
  const [sortKey, setSortKey] = useState<SortKey>("id");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const filteredProducts = useMemo(
    () => sortProducts(products.filter((product) => productMatchesQuery(product, query)), sortKey, sortDirection),
    [products, query, sortDirection, sortKey]
  );
  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDirection((currentDirection) => (currentDirection === "asc" ? "desc" : "asc"));
      return;
    }

    setSortKey(key);
    setSortDirection("asc");
  };
  const renderSortButton = (key: SortKey, label: string, align: "left" | "center" = "left") => {
    const isActive = sortKey === key;
    return (
      <button
        type="button"
        onClick={() => handleSort(key)}
        className={`inline-flex w-full items-center gap-1 rounded px-1 py-1 font-semibold uppercase tracking-[0.1em] transition hover:bg-white/10 ${
          align === "center" ? "justify-center text-center" : "justify-start text-left"
        } ${isActive ? "text-[var(--brand-gold-300)]" : "text-[var(--brand-cream)]"}`}
        aria-label={`Ordenar por ${label}${isActive ? `, orden ${sortDirection === "asc" ? "ascendente" : "descendente"}` : ""}`}
        title={`Ordenar por ${label}`}
      >
        <span>{label}</span>
        <span className="text-[11px]" aria-hidden>
          {isActive ? (sortDirection === "asc" ? "↑" : "↓") : "↕"}
        </span>
      </button>
    );
  };
  const renderSortDirection = (key: SortKey) => {
    if (sortKey !== key) return "";
    return sortDirection === "asc" ? " ↑" : " ↓";
  };

  return (
    <section
      className={`flex min-w-0 flex-col ${
        withDivider
          ? "pb-6 border-b border-[var(--brand-gold-300)]/28 md:pb-0 xl:pr-6 xl:border-b-0 xl:border-r"
          : ""
      }`}
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="[font-family:var(--font-brand-display)] text-xl uppercase tracking-[0.08em] text-[var(--brand-cream)] md:text-2xl">
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
          className="h-4 w-4 shrink-0 text-[var(--brand-gold-300)]"
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
          placeholder="Buscar producto por nombre o ID"
          className="w-full bg-transparent text-sm text-[var(--brand-cream)] placeholder:text-[var(--brand-cream)]/78 focus:outline-none"
          aria-label={`Buscar producto por nombre o ID en ${title}`}
        />
      </label>

      <div className="mb-2 rounded-xl border border-[var(--brand-gold-300)]/25 bg-white/10 p-2 md:hidden">
        <div className="mb-1 flex items-center justify-between gap-2">
          <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--brand-cream)]/82">
            Ordenar
          </p>
          <p className="text-[10px] font-semibold text-[var(--brand-cream)]/70">
            Tap para invertir
          </p>
        </div>
        <div className="grid grid-cols-4 gap-1">
          {sortOptions.map((option) => {
            const isActive = sortKey === option.key;
            return (
              <button
                key={option.key}
                type="button"
                onClick={() => handleSort(option.key)}
                className={`min-h-8 rounded-full border px-1.5 text-[10px] font-bold transition ${
                  isActive
                    ? "border-[var(--brand-gold-300)] bg-[var(--brand-gold-300)] text-[var(--brand-violet-950)]"
                    : "border-white/24 bg-white/12 text-[var(--brand-cream)]"
                }`}
                aria-label={`Ordenar por ${option.label}${isActive ? `, orden ${sortDirection === "asc" ? "ascendente" : "descendente"}` : ""}`}
              >
                {option.label}
                {renderSortDirection(option.key)}
              </button>
            );
          })}
        </div>
      </div>

      {filteredProducts.length === 0 ? (
        <p className="rounded-xl border border-dashed border-[var(--brand-gold-300)]/30 px-4 py-6 text-center text-sm text-[var(--brand-cream)]/78">
          {products.length === 0
            ? "No hay productos para este rubro."
            : "No hay productos que coincidan con la búsqueda."}
        </p>
      ) : (
        <>
          <div className="hidden overflow-hidden rounded-xl border border-[var(--brand-gold-300)]/25 bg-white shadow-[0_16px_30px_rgba(12,6,24,0.25)] md:block">
            <table className="w-full border-collapse text-left text-sm text-[#2a1644]">
              <colgroup>
                <col style={{ width: 70 }} />
                <col style={{ width: 58 }} />
                <col />
                <col style={{ width: 76 }} />
                <col style={{ width: 84 }} />
              </colgroup>
              <thead className="bg-[var(--brand-violet-900)] text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--brand-cream)]">
                <tr>
                  <th scope="col" className="px-2 py-2.5 font-semibold">
                    {renderSortButton("active", "Activo", "center")}
                  </th>
                  <th scope="col" className="px-2 py-2.5 text-center font-semibold">
                    {renderSortButton("id", "ID", "center")}
                  </th>
                  <th scope="col" className="px-2 py-2.5 font-semibold">
                    {renderSortButton("name", "Nombre")}
                  </th>
                  <th scope="col" className="px-2 py-2.5 text-center font-semibold">
                    {renderSortButton("stock", "Stock", "center")}
                  </th>
                  <th scope="col" className="px-3 py-2.5 text-center font-semibold">
                    Editar
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--brand-violet-700)]/12">
                {filteredProducts.map((product) => (
                  <tr
                    key={product.id}
                    className={`transition-colors hover:bg-[rgba(92,54,150,0.08)] ${
                      isOutOfStock(product) ? "bg-[#fff1f2]" : ""
                    }`}
                  >
                    <td className="px-2 py-3 text-center align-middle">
                      <ActiveIndicator product={product} compact />
                    </td>
                    <td className="px-2 py-3 text-center align-middle font-mono text-xs font-semibold text-[#5a4867]">
                      {product.id}
                    </td>
                    <td className="min-w-0 px-2 py-3 align-middle">
                      <p className="break-words text-sm font-semibold leading-snug text-[#2a1644]">
                        {product.name}
                      </p>
                      {product.isFeatured ? (
                        <p className="mt-0.5 text-[11px] font-semibold text-[var(--brand-violet-700)]">Destacado</p>
                      ) : null}
                    </td>
                    <td className="px-2 py-3 text-center align-middle text-xs font-bold text-[#5a4867]">
                      {stockValue(product)}
                    </td>
                    <td className="px-3 py-3 text-center align-middle">
                      <button
                        type="button"
                        onClick={() => onEdit(product)}
                        className="inline-flex h-9 w-9 items-center justify-center rounded-md bg-[var(--brand-gold-300)] text-[var(--brand-violet-950)] transition hover:brightness-105"
                        aria-label={`Editar ${product.name}`}
                        title="Editar"
                      >
                        <PencilIcon />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <ul className="space-y-1.5 md:hidden">
            {filteredProducts.map((product) => (
              <li
                key={product.id}
                className={`rounded-xl border p-2.5 text-[#2a1644] shadow-[0_8px_16px_rgba(45,22,75,0.1)] ${
                  isOutOfStock(product)
                    ? "border-[#fecdd3] bg-[#fff1f2]"
                    : "border-[#e4d8ec] bg-[#fbf8ff]"
                }`}
              >
                <div className="flex items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="break-words text-sm font-bold leading-snug">{product.name}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] font-semibold text-[#715889]">
                      <span className="rounded-full bg-[#efe5f8] px-2 py-0.5 font-mono text-[10px] font-bold text-[var(--brand-violet-700)]">
                        ID {product.id}
                      </span>
                      <span>Stock {stockValue(product)}</span>
                      {product.isFeatured ? (
                        <>
                          <span aria-hidden>·</span>
                          <span>Destacado</span>
                        </>
                      ) : null}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <ActiveIndicator product={product} compact />
                    <button
                      type="button"
                      onClick={() => onEdit(product)}
                      className="inline-flex h-9 w-9 items-center justify-center rounded-md bg-[var(--brand-gold-300)] text-[var(--brand-violet-950)] transition hover:brightness-105"
                      aria-label={`Editar ${product.name}`}
                      title="Editar"
                    >
                      <PencilIcon />
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </>
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
  const [activeDepartment, setActiveDepartment] = useState<DepartmentTab>("peluqueria");
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
  const firstImage = editingProduct?.images.find((image) => image.trim())?.trim() ?? "";

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

  const mobileTabs = [
    { key: "peluqueria" as const, label: "Peluquería", count: peluqueriaProducts.length },
    { key: "bijouterie" as const, label: "Bijouterie", count: bijouterieProducts.length },
  ];

  return (
    <>
      <div className="mb-4 grid grid-cols-2 gap-2 md:hidden">
        {mobileTabs.map((tab) => {
          const isActive = activeDepartment === tab.key;
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveDepartment(tab.key)}
              aria-pressed={isActive}
              className={`flex min-h-10 items-center justify-center gap-1 rounded-full border px-2 text-xs font-bold transition ${
                isActive
                  ? "border-[var(--brand-gold-300)] bg-[var(--brand-gold-300)] text-[var(--brand-violet-950)] shadow-[0_8px_18px_rgba(45,22,75,0.18)]"
                  : "border-white/30 bg-white/16 text-[var(--brand-cream)] hover:bg-white/24"
              }`}
            >
              <span className="truncate">{tab.label}</span>
              <span
                className={`inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full px-1 text-[10px] ${
                  isActive ? "bg-white/55" : "bg-white/16"
                }`}
              >
                {tab.count}
              </span>
            </button>
          );
        })}
      </div>

      <div className="md:hidden">
        {activeDepartment === "peluqueria" ? (
          <CatalogColumn title="PELUQUERÍA" products={peluqueriaProducts} onEdit={openProductEditor} />
        ) : (
          <CatalogColumn title="BIJOUTERIE" products={bijouterieProducts} onEdit={openProductEditor} />
        )}
      </div>

      <div className="hidden grid-cols-1 gap-6 md:grid xl:grid-cols-2 xl:gap-8">
        <CatalogColumn
          title="PELUQUERÍA"
          products={peluqueriaProducts}
          onEdit={openProductEditor}
          withDivider
        />
        <CatalogColumn title="BIJOUTERIE" products={bijouterieProducts} onEdit={openProductEditor} />
      </div>

      {editingProduct ? (
        <div className="fixed inset-0 z-[260] flex items-end justify-center bg-black/60 p-0 md:items-center md:p-4">
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
            className={`relative z-10 max-h-[92dvh] w-full max-w-3xl overflow-y-auto rounded-t-3xl border border-[var(--brand-gold-300)]/35 bg-[var(--brand-violet-950)] p-4 text-[var(--brand-cream)] shadow-[0_-18px_46px_rgba(4,2,10,0.55)] md:max-h-[92vh] md:rounded-2xl md:p-5 md:shadow-[0_24px_52px_rgba(4,2,10,0.55)] ${
              isSavingProduct ? "pointer-events-none opacity-85" : ""
            }`}
          >
            <input type="hidden" name="productId" value={editingProduct.id} />
            <input type="hidden" name="redirectTo" value="/admin/productos" />

            <div className="mb-4 flex items-start justify-between gap-3 border-b border-[var(--brand-gold-300)]/20 pb-4">
              <div className="min-w-0">
                <p className="text-xs uppercase tracking-[0.12em] text-[var(--brand-gold-300)]/85">Editar producto</p>
                <h3 className="[font-family:var(--font-brand-display)] text-2xl leading-tight">{editingProduct.name}</h3>
                <p className="mt-1 text-xs text-[var(--brand-cream)]/70">
                  ID: {editingProduct.id} | Rubro: {editingProduct.departament || "Sin rubro"}
                </p>
              </div>
              <button
                type="button"
                onClick={closeProductEditor}
                disabled={isSavingProduct}
                className="shrink-0 rounded-full border border-[var(--brand-gold-300)]/35 px-3 py-2 text-sm transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-60"
                aria-label="Cerrar modal de edición"
              >
                Cerrar
              </button>
            </div>

            {firstImage ? (
              <div className="mb-4 overflow-hidden rounded-2xl border border-[var(--brand-gold-300)]/25 bg-white/8">
                <div className="relative aspect-[4/3] w-full bg-white/5">
                  <Image
                    src={firstImage}
                    alt={`Primera imagen de ${editingProduct.name}`}
                    fill
                    sizes="(max-width: 768px) 100vw, 720px"
                    className="object-contain"
                  />
                </div>
                <p className="border-t border-[var(--brand-gold-300)]/15 px-3 py-2 text-xs text-[var(--brand-cream)]/70">
                  Preview principal: primera imagen del producto.
                </p>
              </div>
            ) : null}

            <div className="grid gap-4 md:grid-cols-2">
              <label className="flex min-h-11 items-center gap-2 rounded-xl border border-[var(--brand-gold-300)]/25 bg-white/5 px-3 py-2 text-sm">
                <input
                  type="checkbox"
                  name="active"
                  defaultChecked={editingProduct.active}
                  className="h-4 w-4 accent-[var(--brand-gold-300)]"
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

              <label className="flex flex-col gap-1 text-xs font-semibold uppercase tracking-[0.08em] text-[var(--brand-cream)]/80">
                Destacado
                <select
                  name="isFeatured"
                  defaultValue={editingProduct.isFeatured ? "true" : "false"}
                  className="rounded-lg border border-[var(--brand-gold-300)]/30 bg-white px-2.5 py-2 text-sm font-normal text-slate-900"
                >
                  <option value="false">No</option>
                  <option value="true">Sí</option>
                </select>
              </label>

              <label className="flex flex-col gap-1 text-xs font-semibold uppercase tracking-[0.08em] text-[var(--brand-cream)]/80 md:col-span-2">
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

              <label className="flex flex-col gap-1 text-xs font-semibold uppercase tracking-[0.08em] text-[var(--brand-cream)]/80">
                Tipo
                <select
                  name="productType"
                  defaultValue={editingProduct.productType}
                  className="rounded-lg border border-[var(--brand-gold-300)]/30 bg-white px-2.5 py-2 text-sm font-normal text-slate-900"
                >
                  <option value="UNICO">Único</option>
                  <option value="KIT">Kit</option>
                </select>
              </label>

              <div className="flex flex-col gap-1 text-xs font-semibold uppercase tracking-[0.08em] text-[var(--brand-cream)]/80">
                Estado de stock
                <div className="rounded-lg border border-[var(--brand-gold-300)]/30 bg-white px-2.5 py-2 text-sm font-normal text-slate-900">
                  {stockStatusLabels[editingProduct.stockStatus]}
                </div>
              </div>

              <label className="flex flex-col gap-1 text-xs font-semibold uppercase tracking-[0.08em] text-[var(--brand-cream)]/80">
                Cantidad
                <input
                  name="stockQty"
                  type="number"
                  min={0}
                  step="1"
                  defaultValue={editingProduct.stockQty ?? ""}
                  placeholder="Sin control"
                  className="rounded-lg border border-[var(--brand-gold-300)]/30 bg-white px-2.5 py-2 text-sm font-normal text-slate-900"
                />
              </label>

              <label className="flex flex-col gap-1 text-xs font-semibold uppercase tracking-[0.08em] text-[var(--brand-cream)]/80 md:col-span-2">
                Descripción corta
                <textarea
                  name="shortDescription"
                  rows={3}
                  defaultValue={editingProduct.shortDescription}
                  className="rounded-lg border border-[var(--brand-gold-300)]/30 bg-white px-2.5 py-2 text-sm font-normal text-slate-900"
                />
              </label>

              <label className="flex flex-col gap-1 text-xs font-semibold uppercase tracking-[0.08em] text-[var(--brand-cream)]/80 md:col-span-2">
                Descripción larga
                <textarea
                  name="description"
                  rows={8}
                  defaultValue={editingProduct.description}
                  className="rounded-lg border border-[var(--brand-gold-300)]/30 bg-white px-2.5 py-2 text-sm font-normal text-slate-900"
                />
              </label>

              <label className="flex flex-col gap-1 text-xs font-semibold uppercase tracking-[0.08em] text-[var(--brand-cream)]/80 md:col-span-2">
                Incluye (kits, uno por línea)
                <textarea
                  name="includes"
                  rows={4}
                  defaultValue={includesValue}
                  className="rounded-lg border border-[var(--brand-gold-300)]/30 bg-white px-2.5 py-2 text-sm font-normal text-slate-900"
                />
              </label>

              <label className="flex flex-col gap-1 text-xs font-semibold uppercase tracking-[0.08em] text-[var(--brand-cream)]/80 md:col-span-2">
                Enlaces de imágenes (uno por línea)
                <textarea
                  name="images"
                  rows={5}
                  defaultValue={imagesValue}
                  className="rounded-lg border border-[var(--brand-gold-300)]/30 bg-white px-2.5 py-2 text-sm font-normal text-slate-900"
                />
              </label>
            </div>

            <div className="mt-5 grid grid-cols-2 gap-2 md:flex md:justify-end">
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
