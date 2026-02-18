# Changelog

## 2026-02-18 — Fase 0 + Fase 1 (estabilidad y coherencia)

### Qué se cambió
- Verificación de tokens globales: se confirmó `src/core/presentation/styles/tokens.css` y su import global desde `app/globals.css`.
- Se completaron estilos/tokens faltantes para evitar UI inconsistente:
  - Variables `--brand-violet-500` y `--brand-violet-strong`.
  - Utilidad `.scrollbar-hide`.
- Se robusteció la detección de “estoy en tienda” en el navbar para que funcione tanto con como sin `basePath`.
- Se eliminó el hook stub peligroso `useCart.ts` (vacío) para evitar imports ambiguos.
- Se endureció `fetchProductsFromSheets`:
  - sin IDs aleatorios,
  - descarte de filas sin ID válido,
  - warning al descartar,
  - parseo y normalización más estricta de booleanos, imágenes y precio.
- Se corrigió la dirección de dependencias:
  - `infrastructure` usa `Product` de `domain` (no desde `presentation`).
  - Se centralizó el tipo `Product` en `src/features/shop/domain/entities/Product.ts`.
- Se unificó la inyección de variables de tema:
  - `layout.tsx` como única fuente de verdad.
  - `HomeSplit` ahora solo consume `var(--...)`.

### Por qué
- Evitar errores de build/export por estilos o imports faltantes.
- Evitar inconsistencias entre `npm run dev` y GitHub Pages (`basePath`).
- Evitar roturas del carrito/persistencia por IDs no determinísticos.
- Mantener separación de capas (domain/infrastructure/presentation).
- Reducir duplicación de lógica de tema para mantener coherencia visual.

### Archivos tocados
- `app/layout.tsx`
- `src/core/presentation/components/Navbar/Navbar.tsx`
- `src/core/presentation/styles/tokens.css`
- `src/features/home/presentation/components/HomeSplit/HomeSplit.tsx`
- `src/features/shop/domain/entities/Product.ts`
- `src/features/shop/infrastructure/data/fetchProducts.ts`
- `src/features/shop/presentation/components/ProductCard/ProductCard.tsx`
- `src/features/shop/presentation/components/ProductsGrid/ProductsGrid.tsx`
- `src/features/shop/presentation/components/QuickViewModal/QuickViewModal.tsx`
- `src/features/shop/presentation/pages/ProductDetail.tsx`
- `src/features/shop/presentation/pages/TiendaClientView.tsx`
- `src/features/shop/presentation/pages/TiendaPage.tsx`
- `src/features/shop/presentation/view-models/useProductsStore.ts`
- `app/tienda/producto/[slug]/page.tsx`
- Eliminado: `src/features/shop/presentation/view-models/useCart.ts`

### Riesgos mitigados
- Imports ambiguos de `useCart` que podían apuntar a un stub.
- Definiciones CSS faltantes (`scrollbar-hide`, variables violeta) que afectaban interacción/estilo.
- Productos sin ID estable ingresando al catálogo.
- Dependencias invertidas entre capas.
