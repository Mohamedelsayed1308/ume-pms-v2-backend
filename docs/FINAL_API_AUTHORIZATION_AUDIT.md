# FINAL API AUTHORIZATION AUDIT

Classification: **A** = authentication + module authorization · **B** = authenticated but no module-level authorization · **C** = intentionally public · **D** = security issue.

## Summary of current posture
- **Authentication:** every controller now requires `JwtAuthGuard` (the previously-unguarded `tasks`, `tasks/assistant`, `profit-periods` were fixed in the pre-MVP hotfix).
- **Module authorization (`allowed_screens`):** historically **frontend-only**. This phase introduced a reusable server-side `ScreenAuthzService` and applied it to the **highest-risk endpoints** (AI/data-egress). Most CRUD data endpoints remain **B** (authenticated, JWT-only) — see recommendation.

## A — Authentication + module authorization
| Endpoint | Authorization |
|---|---|
| `POST /api/ask-ume` | JWT + per-tool `allowed_screens` (server-resolved) |
| `POST /api/tasks/assistant` | JWT + `tasks` screen |
| `POST /api/invoices/assistant` | JWT + `invoices` screen |
| `POST /api/invoices/extract` | JWT + `invoices` screen |
| `POST /api/fleet/assistant` | JWT + (`vessels` OR `reports`) screen |
| `GET/PUT /api/auth/users*`, permissions, active | JWT + `role==='admin'` |

## B — Authenticated (JWT) but no module authorization
All standard data CRUD controllers: `suppliers`, `vessels`, `purchase-orders`, `invoices` (CRUD), `payments`, `items`, `customers`, `hire-invoices`, `management-invoices`, `shipping-companies`, `exchange-rates`, `attachments`, `currencies`, `vessel-profit`, `profit-periods`, `tasks` (CRUD), `GET /api/fleet/dashboard`.
- Impact: an authenticated user can call any of these regardless of their `allowed_screens` (the frontend hides them, but the API does not enforce). Not a data-egress-to-third-party risk (that path is the AI, now closed), but it is broader-than-intended internal data access.

## C — Intentionally public
| Endpoint | Note |
|---|---|
| `POST /api/auth/login` | required for login |
| `GET /api/auth/seed` | **flagged for review** — public admin-seed; verify it is idempotent/no-op when an admin already exists, or restrict/remove post-bootstrap. |

## D — Security issue (status)
- Previously unauthenticated `tasks`, `tasks/assistant`, `profit-periods` → **REMEDIATED** (JWT added in hotfix).
- No remaining fully-open sensitive write endpoints found.

## Recommendation (scoped, low-regression)
1. **AI/data-egress endpoints:** ✅ done (module authz enforced this phase) — this is where unauthorized data could leave the environment.
2. **Broad B→A conversion:** apply `ScreenAuthzService` to sensitive CRUD endpoints in a **controlled follow-up**, endpoint-by-endpoint with regression testing. Do NOT blanket-apply now: some screens legitimately cross-fetch (e.g. the Reports page loads vessel/supplier name lists for filters even without those screens; the dashboard cross-fetches permitted modules). Blanket server-side enforcement would break those flows. The reusable guard is now in place for that follow-up.
3. **`/api/auth/seed`:** review and restrict/remove after bootstrap.

## Scope control
No new RBAC platform introduced. Reused `role` + `allowed_screens` + existing users table + existing screen identifiers via a single centralized `ScreenAuthzService` (no per-controller duplicated permission logic).
