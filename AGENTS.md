# Repository instructions for AI agents

## Default workflow

- Use a Draft PR unless the user explicitly authorizes rollout.
- Creating or updating the Draft PR is the end of an implementation task.
- Never merge, mark Ready, enable auto-merge, close, or deploy without explicit authorization.
- Never interpret “looks good” as merge authorization.

## Rollout contract

- Explicit rollout authorization applies only to the approved PR, base, HEAD, and tree.
- Verify all approved anchors, required CI, and mergeability before merging.
- During rollout, do not change code, rebase, force-push, or fix discrepancies.
- Stop on any anchor, CI, or mergeability mismatch.
- Use only the explicitly authorized merge method.
- After merge, verify the resulting `main` tree exactly equals the approved tree.
- Allow only the automatic Vercel Git deployment unless a manual deployment is explicitly authorized.
- Any mismatch or failure means: STOP AND REPORT.

## Production safety

Never without explicit authorization:

- modify Production Google Sheets or Production KV;
- modify Mercado Pago or Resend;
- publish Apps Script;
- manually deploy, promote, or redeploy Vercel;
- run real checkout, payment, order, shipping, stock, or email mutations;
- trigger Production recovery jobs;
- use `.env.local` for validation.

## Code workflow

- Start from the exact requested base SHA.
- Prefer the minimum delta and do not refactor unrelated code.
- Search targeted symbols first.
- Read only directly relevant producer, validator, store, projector, consumer, recovery, and test paths.
- Do not recursively inspect the repository unless evidence requires it.
- Existing architecture and invariants win over local convenience.
- Fail closed for financial, inventory, recovery, and authority ambiguity.
- Preserve existing durable and idempotency evidence.

## Token-efficient context loading

- `AGENTS.md` always applies.
- Do not load `docs/ai/*` wholesale.
- Read only the affected sections of `docs/ai/ARCHITECTURE.md`.
- Use `docs/ai/PROJECT_STATE.md` only when project or audit state matters.
- Live repository and GitHub evidence wins over stale documentation.
- Report documentation that is materially stale for the current task.

## Validation

Default safe validation:

```text
npm ci
npm run lint
npm run typecheck
npm run test
npm run build
git diff --check
```

- Use inert or synthetic configuration.
- Never use real providers or Production data for validation.

## Reporting

Keep implementation results compact:

- PR;
- base;
- HEAD;
- tree;
- files changed;
- tests;
- CI;
- Preview;
- blockers or deferred work;
- Production mutations: none.

Do not paste full files or huge command logs. Summarize PASS/FAIL and include details only on failure.

## Review tasks

- Review the actual diff, not the author’s description.
- Consolidate symptoms by root cause.
- Use evidence in the form `path + symbol/function + concise conclusion`.
- Classify findings as `BLOCKER`, `NON-BLOCKER`, or `DEFERRED`.
- Do not change code during a read-only audit or review.

## Follow-up fixes

- Modify the same Draft PR.
- Keep the change delta-only.
- Read changed code and directly affected dependencies only.
- Do not repeat the original task history.
