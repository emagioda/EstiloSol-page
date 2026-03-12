# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev          # Dev server (localhost:3000)
npm run build        # Production build
npm run lint         # ESLint
npm run typecheck    # TypeScript check (no emit)
npm run test         # Vitest single run
npm run test:watch   # Vitest watch mode
```

## Architecture

EstiloSol is a Next.js 16 (App Router) full-stack e-commerce + booking app for an Argentine hair salon. It sells products and offers appointment booking.

### Layer Structure

```
src/
  config/         # brand.ts (single source of truth for colors/content/nav), env.ts (typed env access)
  core/           # Cross-cutting: Result<T>, DomainError, httpClient, storage abstractions, shared UI (Navbar, Footer)
  features/       # Domain slices: booking/, shop/, home/
    {feature}/
      domain/           # Entities, value objects, repository interfaces
      application/      # Use-cases, DTOs
      infrastructure/   # Repository implementations, data fetching, mock JSON
      presentation/     # Components, pages, view-models (hooks)
  server/         # Server-only logic (never imported from client)
    catalog/      # Product catalog fetch + KV cache
    orders/       # Order CRUD (KV store + Sheets sync)
    payments/     # Mercado Pago client + webhook validation
    sheets/       # Google Sheets repository (persistent storage)
    observability/ # Structured logging, metrics, alerts
    security/     # Rate limiting (KV-backed)
    notifications/ # Email via Resend
app/              # Next.js App Router: pages, layouts, API routes
```

### Data Storage (no traditional DB)

- **Vercel KV (Redis)**: Transient order state, catalog cache, rate limiting. Falls back to in-memory `Map` if `KV_*` env vars are absent (fine for local dev).
- **Google Sheets via Apps Script** (`SHEETS_ENDPOINT`): Persistent orders + product catalog. Falls back to `products.mock.json` if endpoint is missing.

### Key Data Flows

**Checkout flow**: Cart (localStorage via `useCartStore`) → `POST /api/mp/create-preference` → Mercado Pago redirect → webhook at `POST /api/mp/webhook` → order status updated in KV + synced to Sheets → receipt email via Resend.

**Product catalog**: Google Sheets endpoint → `src/server/catalog/getProducts.ts` (fetches + caches in KV, TTL-based) → `ProductDTO` → `ProductsGrid`.

**Admin panel**: Google OAuth (`/auth/signin`) via NextAuth — only the email in `ADMIN_EMAIL` env var is granted access.

### Key Conventions

- **Error handling**: Use `Result<T>` (`{ ok: true; value: T } | { ok: false; error: Error }`) at use-case boundaries. Throw `DomainError` for domain violations.
- **Styling**: All brand colors/fonts come from `src/config/brand.ts` → injected as CSS custom properties (e.g. `--brand-violet-950`). Never hardcode colors.
- **Env vars**: Access only through `src/config/env.ts`. Server-only vars (no `NEXT_PUBLIC_` prefix) must never be imported in client components.
- **Startup validation**: `instrumentation.ts` calls `runStartupChecks()` at boot — crashes in production if critical env vars (e.g. `MP_ACCESS_TOKEN`) are missing.
- **Don't import domain entities/repos directly into UI** — always through use-cases or view-models.

### External Services

| Service | Env Vars | Purpose |
|---|---|---|
| Mercado Pago | `MP_ACCESS_TOKEN`, `NEXT_PUBLIC_MP_PUBLIC_KEY`, `MP_WEBHOOK_SECRET` | Payments |
| Google Sheets (Apps Script) | `SHEETS_ENDPOINT`, `NEXT_PUBLIC_SHEETS_ENDPOINT` | Product catalog + orders |
| NextAuth + Google OAuth | `AUTH_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `ADMIN_EMAIL` | Admin auth |
| Vercel KV | `KV_REST_API_URL`, `KV_REST_API_TOKEN` | Cache + order state |
| Resend | `RESEND_API_KEY`, `CONTACT_TO_EMAIL`, `CONTACT_FROM_EMAIL` | Transactional email |

See `.env.example` for the full list including `APP_BASE_URL`, `MP_WEBHOOK_URL`, `MP_SUCCESS_URL`, etc.
