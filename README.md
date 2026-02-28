# PAGE-EstiloSol
Tienda online liviana – Next.js + Google Sheets + Cloudinary

This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Mercado Pago Checkout Pro

1. Copy `.env.example` to `.env.local`.
2. Complete the Mercado Pago variables:

```bash
MP_ACCESS_TOKEN=...
NEXT_PUBLIC_MP_PUBLIC_KEY=...
APP_BASE_URL=http://localhost:3000
MP_WEBHOOK_SECRET=...
MP_WEBHOOK_URL=https://tu-dominio.com/api/mp/webhook
MP_SUCCESS_URL=https://tu-dominio.com/tienda
MP_FAILURE_URL=https://tu-dominio.com/tienda
MP_PENDING_URL=https://tu-dominio.com/tienda
```

3. In Mercado Pago Developers, configure `MP_WEBHOOK_URL` and copy the secret into `MP_WEBHOOK_SECRET`.
4. Checkout Pro creates preferences from backend in `/api/mp/create-preference` and validates webhook signatures in `/api/mp/webhook`.

### Security notes

- Never expose `MP_ACCESS_TOKEN` in client code.
- Keep `.env.local` out of git (already ignored).
- If an access token was shared publicly, rotate it immediately in Mercado Pago.

### Reliability & Privacy baseline

- Payment endpoints now use centralized request validation and shared rate limiting.
- Calls to Mercado Pago use controlled timeout/retry policy to avoid hanging requests.
- Payment events are logged with structured JSON and `externalReference` traceability.
- Business observability now tracks key events (preference requested/created/failed, verify approved/pending, webhook dedupe/approved).
- Idempotency is enforced through `X-Idempotency-Key` and webhook/payment deduplication keys.
- Order records use status-based TTL (7 or 30 days); after approval, customer data is minimized and notes are removed.

### Startup checks

- Automatic startup checks run through `instrumentation.ts`.
- In production, startup fails if critical payment secrets are missing.
- `/api/health` returns startup check state and warnings.
- Optional rotation governance vars: `MP_ACCESS_TOKEN_ROTATED_AT` and `MP_WEBHOOK_SECRET_ROTATED_AT` (ISO date).

### Internal business metrics

- Internal route: `/api/ops/metrics` (protected by `OPS_METRICS_TOKEN` via `x-ops-token` header).
- Supports `days=1..14` to inspect aggregated checkout/payment events per day.
- Designed for operational dashboards without storing raw customer PII.
- Internal alerts route: `/api/ops/alerts` (same token) with automatic warning/critical evaluation.

### Post-deploy checks

- Run `npm run ops:postdeploy` after deploy.
- Optional base URL argument: `npm run ops:postdeploy -- https://tu-dominio.com`
- Uses `APP_BASE_URL` and `OPS_METRICS_TOKEN` when available.

### Security operations

- See [SECURITY_OPERATIONS.md](SECURITY_OPERATIONS.md) for secret rotation and privacy runbook.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
