# Current project state

Update this file only after a meaningful architecture or audit-state change.

## Task base

Resolve the exact task base from current GitHub `main` at task start and supply it through the Task Packet. Persistent project state does not pin a volatile `main` SHA.

## Critical audit state

- H06 core: COMPLETE
- H06-E receipt durability: COMPLETE
- H07-A: COMPLETE
- H07-B: COMPLETE
- H07-C1: COMPLETE
- H07-D: COMPLETE
- H07-E: COMPLETE
- H07-F: PARTIAL / DEFERRED
  - Reason: geographic delivery-zone validation remains customer self-declaration.
  - Future improvement: map plus polygon or equivalent server-side geographic validation.
- H07-G: DEFERRED

H07 remains open for the deferred scope above.

## Durable infrastructure to preserve

- `_inventory_transactions`
- `_order_recovery_snapshots`
- `_payment_recovery_events`
- `_email_outbox_events`
- `ventas.receipt_outbox_version`

`ventas` contains the structured fulfillment columns required by the current Apps Script contract.
