# Current architecture

This is a compact invariant reference for the current repository. Update it only when the architecture changes materially.

## Application role

- The product is a Next.js App Router application.
- `app/` contains pages, Route Handlers, and Admin server actions.
- `src/` contains domain rules and server-side integrations.
- Browser input is untrusted; financial, catalog, stock, fulfillment, and recovery decisions are revalidated server-side.
- Apps Script is the authenticated gateway to the operational spreadsheet and its durable evidence sheets.

Primary source anchors:

- `app/api/orders/create/route.ts`
- `app/api/mp/create-preference/route.ts`
- `app/api/mp/webhook/route.ts`
- `app/admin/actions.ts`
- `src/server/orders/store.ts`
- `scripts/apps-script/estilo-sol-api-v4.gs`

## Catalog, product, and cart identity

- The `products` Sheet is authoritative for checkout product identity, active state, price, currency, stock status, and stock quantity.
- Display catalog caches are performance aids, not checkout authority.
- Checkout validation requests a fresh authoritative catalog view and fails closed on missing, inactive, unavailable, duplicate, malformed, insufficient-stock, or price-changed products.
- Each purchasable variant has its own exact `productId`.
- The selected `productId` must survive unchanged through cart demand, checkout validation, `Order.items`, inventory demand, and stock mutation.
- Never substitute `group_id`, slug, display name, or cart `lineId` for `productId`.
- Cart lines may be aggregated for inventory by normalized product key, but the durable item identity remains `productId`.
- Duplicate authoritative product IDs are an integrity error, not a tie to resolve heuristically.

Relevant code:

- `src/server/catalog/source.ts`
- `src/server/catalog/stock.ts`
- `src/server/inventory/items.ts`
- `src/features/shop/domain/cartLines.ts`

## Order KV authority

- Operational Orders are stored in KV under `es:order:<externalReference>`.
- The KV Order contains payment, shipping, inventory, items, totals, customer snapshot, fulfillment snapshot, and projection markers.
- Per-Order write locks serialize state transitions and re-read the newest state before committing.
- Whenever a coherent KV Order exists, it is the operational authority for Admin mutations and projections.
- Payment and shipping changes must preserve coherent status combinations and existing durable evidence.
- A confirmed inventory projection cannot erase a proven prior stock deduction.
- Trusted completed shipping is terminal during ordinary Admin editing.

## `ventas` role

- `ventas` is the durable sales projection and Admin read model.
- It is also a controlled fallback authority when the KV Order is genuinely absent.
- `ventas` must contain exactly one coherent row for fallback authority; duplicates or conflicting identity fail closed.
- Sheet data is not blindly spread into a reconstructed KV Order.
- Current KV state is projected to `ventas` under the normal Order coordination rules.
- Deferred or failed projections are indexed in KV and recovered idempotently.
- `ventas.receipt_outbox_version = 1` marks a confirmed sale as eligible for the v1 purchase-receipt event.

## Apps Script role

- Apps Script validates scoped tokens for reads and writes.
- It exposes catalog, fulfillment, `ventas`, inventory, Admin status, recovery, and email-outbox operations.
- Mutating operations execute under `ScriptLock`.
- The Admin fallback stale-state comparison and conditional Sheet update stay inside that lock.
- Advanced Sheets batch updates atomically combine stock changes and inventory journal evidence.
- Apps Script schemas and lock semantics are part of the production contract; do not bypass them.

## Financial authority

- Mercado Pago is authoritative for Mercado Pago financial state.
- Provider observations are accepted only after payment ID, external reference, amount, currency, and status validation.
- The Mercado Pago ledger preserves observed payment evidence and deduplicates provider replay.
- Admin cannot manually confirm a Mercado Pago payment; Admin confirmation first obtains provider authority.
- Admin is authoritative only for the legitimate manual transition `pending -> confirmed` on `cash` or `transfer`.
- A manual confirmation uses canonical `manual-<externalReference>` payment identity, durable `approvedAt`, and `mpStatus = manual_confirmed`.
- Ordinary Admin editing cannot downgrade a confirmed payment or rewrite terminal financial history.
- Provider, recovery, and system authorities remain separate from manual Admin authority.

Relevant code:

- `src/server/orders/paymentTransition.ts`
- `src/server/payments/adminConfirmation.ts`
- `src/server/payments/ledger.ts`

## Inventory journal

- `_inventory_transactions` is the authoritative idempotency journal for stock deduction.
- Its durable key is the Order ID plus a fingerprint of normalized product-and-quantity demand.
- The first valid application atomically updates stock and appends `APPLIED` journal evidence.
- Replay with the same Order ID and demand returns the existing application without a second stock effect.
- Replay with different demand is an idempotency conflict.
- `Order.inventoryStatus` and `stockDeductedAt` are projections of the effect and may be repaired from journal replay.
- All paid-order stock work must use the existing idempotent inventory primitive.

Relevant code:

- `src/server/orders/inventory.ts`
- `src/server/sheets/repository.ts`
- `scripts/apps-script/estilo-sol-api-v4.gs`

## Fulfillment snapshot and completion gate

- An Order captures a fulfillment snapshot at checkout; later live configuration changes do not rewrite it.
- The snapshot contains monetary components and either delivery-zone/address data or pickup-point data.
- Delivery-zone membership is currently a customer confirmation, not server-side geographic proof.
- Shipping completion requires confirmed payment.
- Shipping completion requires authoritative inventory state `deducted`.
- Inventory conflict or error blocks completion for business attention.
- Snapshot totals must reconcile with the Order total and required delivery or pickup fields must be complete.
- Historical `completed` is trusted only when payment, journal-backed inventory, and fulfillment evidence remain coherent.

Relevant code:

- `src/server/orders/createFromCheckout.ts`
- `src/server/orders/fulfillmentCompletion.ts`
- `src/server/fulfillment/source.ts`

## Missing-KV destination arbitration

- Work prepared while a KV Order is missing is not permission to keep using Sheet fallback indefinitely.
- Before the final fallback commit, the normal per-Order lock rechecks KV.
- If KV appeared, current KV authority wins and the operation routes there.
- If KV remains absent, the code re-reads `ventas`, requires exactly one coherent row, validates prepared evidence, and only then performs the narrow fallback action.
- Slow provider, recovery, or inventory preparation stays outside the final arbitration; the authority recheck and destination commit stay inside the lock.

## Recovery and authority precedence

- `_order_recovery_snapshots` stores immutable, hashed checkout facts needed to reconstruct a missing Order.
- `_payment_recovery_events` stores validated protected Mercado Pago observations with stable event keys and processing state.
- Reconstruction begins from the validated snapshot, not from arbitrary `ventas` fields.
- For Mercado Pago, validated provider recovery events establish financial state.
- For cash or transfer, only canonical manual evidence in one coherent `ventas` row can establish confirmation.
- Inventory is accepted only through the existing journal-backed primitive.
- Existing receipt-event evidence restores receipt eligibility.
- A `ventas` completed state is accepted only with proven prior payment, pre-existing inventory journal evidence, and a valid fulfillment snapshot.
- Missing, duplicate, malformed, conflicting, or incomplete authority evidence fails closed to attention.

## Admin authority precedence

- Admin intent is field-specific through `changedFields` plus expected and requested prior states.
- Newest KV state is checked inside the per-Order lock; Sheet fallback uses its lock-protected conditional mutation.
- If the current value is neither expected nor requested, the result is `ORDER_STATE_CHANGED`.
- A true same-intent replay may repair missing idempotent inventory or receipt effects using canonical persisted data.
- A shipping-only save must not become a payment mutation.
- Provider authority outranks manual Admin intent for Mercado Pago.
- Coherent existing KV authority outranks prepared missing-KV Sheet work.

## Email outbox

- `_email_outbox_events` is the durable purchase-receipt outbox.
- The v1 event key is `purchase-receipt/<externalReference>/v1`.
- The canonical payload includes the persisted payment ID, approval timestamp, customer, items, total, and template identity.
- Payload JSON and hash are immutable for an event key; mismatches go to attention rather than overwrite evidence.
- The event key is also the Resend idempotency key.
- Accepted provider state is durable; projection of the accepted marker back to the Order and `ventas` is repairable.
- Recovery can enroll a missing event only from eligible canonical `ventas` data marked by `receipt_outbox_version = 1`.

Relevant code:

- `src/server/emailOutbox/service.ts`
- `src/server/emailOutbox/payload.ts`
- `src/server/emailOutbox/processor.ts`

## Durable evidence: never delete or reset

Never delete, truncate, reset, repurpose, or casually rewrite:

- `_inventory_transactions`;
- `_order_recovery_snapshots`;
- `_payment_recovery_events`;
- `_email_outbox_events`;
- `ventas.receipt_outbox_version` and its eligible rows;
- canonical payment IDs, `approvedAt`, Mercado Pago ledger entries, inventory timestamps, or accepted receipt markers.

These stores are evidence for once-only financial, stock, recovery, and email behavior. Preserve them across fixes, migrations, tests, and operational recovery.
