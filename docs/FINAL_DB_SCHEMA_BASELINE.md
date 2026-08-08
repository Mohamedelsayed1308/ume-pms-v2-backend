# FINAL DB SCHEMA BASELINE (for synchronize:false cutover — future)

## Current state
Production runs TypeORM with **`synchronize: true`** + `autoLoadEntities: true`. Therefore the **live schema mirrors the entity definitions** — the entities are the effective source of truth. This is a documented debt to remove (auto-sync must not govern a production financial schema).

## Entity → table inventory (from `src/modules/**/*.entity.ts`)
| Entity | Table | Key columns (summary) |
|---|---|---|
| Invoice | `invoices` | id (uuid), invoice_number (unique), supplier_id, vessel_id, po_id, item_id, type (enum), status (enum), approval_status, currency, total_amount (decimal 15,2), paid_amount (decimal 15,2), invoice_date, due_date, notes/comment, extracted (jsonb), created_at, updated_at |
| Payment | `payments` | id, invoice_id, payment_type (enum), payment_method (enum), currency, amount (decimal 15,2), payment_date, reference, notes, created_at |
| Supplier | `suppliers` | id, name, contact_person, email, phone, address, country, is_active |
| Vessel | `vessels` | id, name, imo_number (unique), flag, vessel_type, shipping_company_id, owner_name, owner_address, is_active |
| PurchaseOrder | `purchase_orders` | id, po_number, supplier_id, vessel_id, description, order_date, is_active |
| Task | `tasks` | id, title, reason, notes, team, owner, recommended_employee, priority, status, due_date, recurrence, recurrence_next, created_at, updated_at |
| TaskComment | `task_comments` | id, task_id (FK cascade), author, body, created_at |
| User | `users` | id, email (unique), password, full_name, role, is_active, allowed_screens (jsonb), created_at |
| Attachment | `attachments` | id, invoice_id, filename, file_url, … |
| Customer, HireInvoice, ManagementInvoice, ShippingCompany, ExchangeRate, Currency, Item, ProfitPeriod, VesselProfit | respective tables | per entity definitions |

(Full column/type/index/constraint introspection must be captured against the live DB during the actual cutover — see procedure.)

## Safe cutover procedure (deferred — requires a staging/preview DB)
1. Provision a **copy/preview** Postgres (Supabase branch or snapshot restore) — **do not test against production**.
2. Configure TypeORM CLI datasource; run `migration:generate` against the preview DB.
   - If the generated migration is **empty/no-op**, the schema already matches entities → create a **baseline migration** representing current state (no table rebuild, no drops).
   - If it contains changes, **inspect every statement**; ensure no `DROP`/`RENAME` of existing columns/tables; no data loss.
3. On the preview env, set `synchronize: false`, run migrations, start the app, run CRUD + financial golden tests; confirm **no schema mutation on startup**.
4. Only after preview passes: set production `synchronize: false` + deploy with the baseline migration history in place.

## Constraints
- Do not drop data; do not rename/remove existing columns during conversion.
- Do not run generated destructive SQL blindly.
- Cutover is **blocked** until a staging/preview DB is available (owner action).
