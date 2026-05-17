# Copilot Instructions for PAGE-EstiloSol

## Project Overview
PAGE-EstiloSol is a lightweight Next.js e-commerce site for a beauty salon ("Estilo Sol"). The shop flow is active; the public turnos route currently renders a placeholder.

## Architecture Pattern: Clean Architecture + Domain-Driven Design

### Folder Structure by Layer
- `src/core/` — Shared presentation components, hooks and global styles.
- `src/features/` — Feature-specific code organized by domain (`shop`, `home`).
- Active features keep wiring explicit through pages, components, view-models and server modules.
- `src/config/` — Brand & environment configuration (brand.ts drives all styling/content)

### Critical Data Flows

**Shop Feature:** `ProductCard.tsx` / `QuickViewModal.tsx` → `useCart()` hook → `CartProvider` state + localStorage persistence.

**Styling:** All UI colors/fonts sourced from `src/config/brand.ts` — this is the single source of truth. Components reference CSS custom properties set via brandConfig object (e.g., `--brand-violet-950`).

## Key Conventions

### Type Definitions
- Domain entities live in `domain/entities/` — core business logic containers.
- DTOs and value objects should be added only when they are actually used at API or domain boundaries.

### Repositories & In-Memory Storage
- Shop catalog uses `fetchProductsFromSheets` as data source and in-memory/session cache on the client.
- The catalog must come from `/api/catalog`/Google Sheets; do not add hardcoded product fallbacks for the storefront.

### Component Organization
- Page components in `features/*/presentation/pages/`
- Reusable components in `features/*/presentation/components/`
- Custom hooks (view-models) in `features/*/presentation/view-models/` — encapsulate feature logic, return state & actions
- Core reusable components in `src/core/presentation/components/`

### Styling
- Tailwind CSS with custom CSS variables injected from brandConfig
- Dark theme: violet (primary), gold (accent), cream (text), white (highlights)
- Use CSS modules or inline `style={}` for brand-driven theming
- Global styles in `src/core/presentation/styles/tokens.css`

## Development Workflows

### Getting Started
```bash
npm run dev          # Starts Next.js dev server on localhost:3000
npm run build        # Builds for production
npm run lint         # Runs ESLint on all files
```

### Routing
- File-based routing via Next.js App Router: `app/` (layout, pages) and `app/tienda/`, `app/turnos/`
- Routing is handled directly through Next.js App Router files in `app/`.

### Adding Features
1. Create feature folder: `src/features/featureName/`
2. Add only the layers needed by the feature.
3. Build presentation in `presentation/components/`, `presentation/pages/`, and `presentation/view-models/`.
4. Keep wiring explicit through feature hooks/services unless a real DI need appears.

### TypeScript Config
- Path alias `@/*` maps to workspace root — use `@/src/config/brand` instead of `../../../config/brand`
- Strict mode enabled; all types must be explicit

## Integration Points
- **Next.js Image:** Used for optimized images (logo, hero images, product images)
- **Next.js Link:** For client-side navigation between features
- **Google Sheets:** Product and order data flows through the server catalog/sheets modules and `/api/catalog`.

## Common Pitfalls to Avoid
- ❌ Don't hardcode colors/text — pull from `brandConfig` or CSS variables

## Testing & Mocking
- Keep test fixtures local to tests unless they are part of the real runtime flow.
