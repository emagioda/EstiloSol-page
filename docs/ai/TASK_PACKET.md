# Task packet

Mode: IMPLEMENTATION | AUDIT | REVIEW | FOLLOW_UP | ROLLOUT

## Objective


## Base

SHA:

## Approved anchors

Required for `ROLLOUT`; optional for other modes.

PR:

Base:

HEAD:

Tree:

Merge method:

## Scope


## Business rules


## Invariants


## Acceptance criteria


## Directed tests


## Explicitly out of scope


## Infrastructure impact

Apps Script:

Sheets:

KV:

Mercado Pago:

Resend:

Vercel:

New env:

New dependency:

## Delivery

`AUDIT` / `REVIEW`:

- Read-only by default.
- No branch, commit, PR, or mutation unless explicitly requested.

`IMPLEMENTATION` / `FOLLOW_UP`:

- Draft PR only.
- Stop immediately after Draft PR creation or update for manual review.

`ROLLOUT`:

- Requires explicit rollout authorization.
- Approved PR, base, HEAD, and tree anchors are mandatory.
- Execute only the authorized merge and deployment contract from `AGENTS.md`.
- Any mismatch means: STOP AND REPORT.

## Follow-up delta

PR:

Current HEAD:

Blocker:

Required minimum change:

Required regression test:

Do not revisit unrelated code.
