# Phase 2 Notes — Datos en Tiempo Real (CSR)

## Preflight (P0) — Verificación Phase 0/1

- ✅ `useCart.ts` (stub) no existe; los imports de carrito apuntan a `useCartStore.tsx`.
- ✅ No hay uso de `Math.random()` para IDs en el módulo de tienda.
- ✅ `fetchProducts.ts` importa `Product` desde `domain/entities/Product` (tipo canónico).
- ✅ `tokens.css` existe y está importado en `app/globals.css`.
- ✅ La inyección de variables de tema está centralizada en `app/globals.css` (`@theme inline`).
- ✅ Detección de tienda basada en segmentos de pathname (`includes("tienda")`), robusta frente a `basePath`.

## Cambios de Phase 2

1. **Endpoint por variable pública**
   - Se eliminó hardcode de Apps Script.
   - Ahora se usa únicamente `NEXT_PUBLIC_SHEETS_ENDPOINT`.
   - Si falta, se lanza error explícito para manejo controlado en UI.

2. **Carga en tiempo real en cliente (`/tienda`)**
   - El catálogo se carga con `loadProducts()` desde cliente al montar la vista.
   - Estado de store agregado: `status` (`idle | loading | success | error`) + `errorMessage`.
   - UI diferenciada:
     - loading → skeleton,
     - error → estado controlado con botón **Reintentar**,
     - success + 0 resultados por filtros → “sin resultados”.

3. **Compatibilidad con export estático + detalle `[slug]`**
   - Se mantiene `generateStaticParams()` en detalle.
   - Estrategia elegida: **A**.
   - La lista de tienda recibe los handles estáticos generados en build y evita links a detalle para productos nuevos no exportados.
   - En esos casos se muestra badge: **“Nuevo (requiere actualización del sitio)”**.

4. **ISR/revalidate decorativo eliminado**
   - Se removió `next: { revalidate: ... }` del fetch para no sugerir comportamiento ISR en GitHub Pages.

## Limitación conocida (esperada con `output: "export"`)

- La lista `/tienda` refleja cambios de precio/productos al refrescar (CSR).
- Las páginas de detalle nuevas (`/tienda/producto/[slug]`) requieren rebuild para existir como HTML estático.
