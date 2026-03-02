# Copilot Instructions for PAGE-EstiloSol

## Project Overview
PAGE-EstiloSol is a lightweight Next.js e-commerce + booking system for a beauty salon ("Estilo Sol"). Two main features: haircut appointment booking (turnos) and jewelry e-shop (tienda).

## Architecture Pattern: Clean Architecture + Domain-Driven Design

### Folder Structure by Layer
- `src/core/` — Cross-cutting concerns (application-wide Result types, DomainError base, HTTP client, storage)
- `src/features/` — Feature-specific code organized by domain (booking, shop, home)
- Each feature follows: `domain/` (entities, repos, services) → `application/` (use-cases, DTOs) → `infrastructure/` (repositories, mock data) → `presentation/` (components, pages, view-models)
- `src/config/` — Brand & environment configuration (brand.ts drives all styling/content)

### Critical Data Flows

**Booking Feature:** `ServicePicker.tsx` → `useBooking()` hook → `CreateBooking` use-case → `BookingRepositoryInMemory` → Booking entity stored in memory.

**Shop Feature:** `ProductCard.tsx` / `QuickViewModal.tsx` → `useCart()` hook → `CartProvider` state + localStorage persistence.

**Styling:** All UI colors/fonts sourced from `src/config/brand.ts` — this is the single source of truth. Components reference CSS custom properties set via brandConfig object (e.g., `--brand-violet-950`).

## Key Conventions

### Type Definitions
- DTOs (data transfer objects) live in `application/dto/` — used for API/use-case boundaries
- Domain entities live in `domain/entities/` — core business logic containers
- Value Objects live in `domain/value-objects/` — immutable, identity-less objects (TimeSlot, ProductId, ServiceId)

### Error Handling
- Use `Result<T>` type: `{ ok: true; value: T } | { ok: false; error: Error }`
- Throw `DomainError` for domain-level violations (not for HTTP/infrastructure)
- Example: [Result.ts](../src/core/application/result/Result.ts), [DomainError.ts](../src/core/domain/errors/DomainError.ts)

### Repositories & In-Memory Storage
- Booking data access goes through `BookingRepository`.
- Shop catalog uses `fetchProductsFromSheets` as data source and in-memory/session cache on the client.
- Mock data is in `infrastructure/data/*.mock.json` (currently empty; use as test fixtures)

### Component Organization
- Page components in `features/*/presentation/pages/`
- Reusable components in `features/*/presentation/components/` with `index.ts` barrel exports
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
- File-based routing via Next.js App Router: `src/app/` (layout, pages) and `src/app/tienda/`, `src/app/turnos/`
- Routing is handled directly through Next.js App Router files in `app/`.

### Adding Features
1. Create feature folder: `src/features/featureName/`
2. Define domain layer: `domain/entities/`, `domain/repositories/`, `domain/value-objects/`
3. Add application layer: `application/dto/`, `application/use-cases/`
4. Implement infrastructure: `infrastructure/repositories/` (in-memory), `infrastructure/data/*.mock.json`
5. Build presentation: `presentation/components/`, `presentation/pages/`, `presentation/view-models/`
6. Keep wiring explicit through feature hooks/services unless a real DI need appears.

### TypeScript Config
- Path alias `@/*` maps to workspace root — use `@/src/config/brand` instead of `../../../config/brand`
- Strict mode enabled; all types must be explicit

## Integration Points
- **Next.js Image:** Used for optimized images (logo, hero images, product images)
- **Next.js Link:** For client-side navigation between features
- **External Services (Future):** Mock repositories easily swappable for real API clients in `infrastructure/repositories/`
- **Google Sheets / Cloudinary:** Mentioned in project description but not yet integrated — consider abstracting via HTTP client in `src/core/infrastructure/http/httpClient.ts`

## Common Pitfalls to Avoid
- ❌ Don't import entities/repos directly into UI — always go through use-cases or view-models
- ❌ Don't hardcode colors/text — pull from `brandConfig` or CSS variables
- ❌ Don't mutate data in repositories — return new instances (immutability for entities)
- ❌ Don't skip DTOs — they decouple domains and applications

## Testing & Mocking
- The booking in-memory repository provides a simple test seam for booking flows.
- DTOs validate data shape at boundaries
- Mock data structure should match feature entities (update `.mock.json` files when entity shape changes)
