# Security & Privacy Operations

## Secret Rotation Procedure

### Scope
- `MP_ACCESS_TOKEN` (private, server only)
- `MP_WEBHOOK_SECRET` (private, server only)
- `NEXT_PUBLIC_MP_PUBLIC_KEY` (public)
- `OPS_METRICS_TOKEN` (private, server only, protects ops metrics endpoint)

### Rotation cadence
- `MP_ACCESS_TOKEN`: every 90 days or immediately after suspected exposure.
- `MP_WEBHOOK_SECRET`: every 90 days or after webhook signature anomaly.
- Public key: when Mercado Pago indicates regeneration.

### Rotation steps
1. Generate new credentials in Mercado Pago Developers.
2. Update environment variables in deployment platform.
3. Redeploy application.
4. Verify startup checks in `/api/health`.
5. Verify checkout flow (`/api/mp/create-preference`).
6. Verify payment confirmation (`/api/mp/verify-payment`) and webhook processing.
7. Revoke old credentials in Mercado Pago.

### Automatic checks in this project
- Startup checks run automatically via `instrumentation.ts`.
- In production, missing critical secrets fail startup.
- `/api/health` exposes startup check status and warnings.
- Optional governance dates (`MP_ACCESS_TOKEN_ROTATED_AT`, `MP_WEBHOOK_SECRET_ROTATED_AT`) are checked and warned when stale.

## Operational metrics endpoint

- Route: `/api/ops/metrics`
- Auth header: `x-ops-token: <OPS_METRICS_TOKEN>`
- Query: `days=1..14`
- Purpose: daily aggregates of checkout/payment business events without exposing PII.

## Operational alerts endpoint

- Route: `/api/ops/alerts`
- Auth header: `x-ops-token: <OPS_METRICS_TOKEN>`
- Purpose: evaluate critical/warn conditions (signature failures, rejection spikes, rate-limit spikes).

## Automated post-deploy checks

- Command: `npm run ops:postdeploy`
- Optional explicit base URL: `npm run ops:postdeploy -- https://tu-dominio.com`
- Verifies health/startup checks, validator behavior, ops metrics endpoint and ops alerts endpoint.

## Privacy Operations

### Data minimization
- Customer name is anonymized after payment approval.
- Customer phone is masked after payment approval.
- Notes are removed after payment approval.

### Retention windows by order status
- `created`, `preference_created`, `pending`, `rejected`: 7 days
- `approved`: 30 days

### Dedupe retention
- Webhook and payment dedupe keys: 7 days.

### Operational recommendation
- Keep logs free from raw PII.
- Use `externalReference` for tracing instead of personal fields.
