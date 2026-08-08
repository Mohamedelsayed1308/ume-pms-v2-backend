# FINANCIAL WORKFLOW REMEDIATION PLAN (future — NOT executed in hardening)

## Current behavior (documented debt, unchanged)
Setting `approval_status='paid'` on an invoice causes the backend to also set `status=PAID` and `paid_amount=total` **without creating a Payment transaction row** (`invoices.service.ts`). Consequence: an invoice can read as fully paid while **no actual Payment record exists**. Today there are ~144 invoices marked paid but only 17 actual Payment transactions.

This is **business logic**, not infrastructure. It is explicitly **out of scope** for security hardening and must not be auto-changed. All current UI/AI already keep the three concepts distinct (Approval Status ≠ Invoice Payment Status ≠ Actual Payment Transaction) and compute Outstanding as `total − paid_amount`.

## Target model (future, requires separate approval)
```
Invoice Approval  →  Payment Authorization  →  Actual Payment (Payment row)  →  Reconciliation
```
- **Approval** (`approval_status`): workflow state only; must NOT mutate `status`/`paid_amount`.
- **Payment Authorization**: an explicit "cleared to pay" state (optional intermediate).
- **Actual Payment**: `status`/`paid_amount` change **only** when a Payment row is created; `paid_amount = Σ(payments for the invoice)`.
- **Reconciliation**: verify invoice paid_amount matches the sum of its Payment rows.

## Migration / backward-compatibility considerations
- **Historical 218 invoices:** do not retroactively rewrite. Options for a future migration (to be chosen with the owner):
  1. Leave historical invoices as-is (grandfathered) and apply the new rule only to invoices created after cutover.
  2. Generate synthetic "opening balance / historical settlement" Payment records for the 144 paid-without-payment invoices so `paid_amount` reconciles — clearly flagged as migration entries, not real bank transactions.
- **Data integrity:** any change must preserve current Outstanding figures (per currency) exactly at cutover.
- **Decoupling step:** stop `approval_status='paid'` from writing `status`/`paid_amount`; introduce an explicit "record payment" action that creates the Payment row (which then updates `paid_amount`).
- **Reporting:** the "paid via invoice status / no payment transaction" label already surfaces the gap; keep it until migration completes.

## Recommendation
Schedule as a dedicated **business-logic** phase with owner sign-off, its own QA (golden financial tests + historical reconciliation), and a reversible migration. **No action taken during Final Security Hardening.**
