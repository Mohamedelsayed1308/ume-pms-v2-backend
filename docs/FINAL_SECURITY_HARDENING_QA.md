# FINAL SECURITY HARDENING — QA / STATUS

Incremental, one-domain-at-a-time hardening on `ume-pms-v2`. Two production deploys completed and verified this phase; several items are **blocked on the owner's Supabase/Railway console access** (credential rotation, synchronize cutover) and one **new P0 was discovered**.

## Deploy references
| Item | Value |
|------|-------|
| Backend before phase | `4d641086` |
| Backend after CORS | `e096dfbf` (deployed, verified) |
| Backend after AI authz + logging | `8acdb2e8` (deployed, healthy) |
| Backend after JWT hardening + payments/tasks guards | `2e0c19c8` (deployed, verified) |
| Rollback targets | `8acdb2e8` (JWT), `e096dfbf` (AI authz), `4d641086` (pre-hardening) |

## Report
1. **DB credential rotation** — ⛔ **NOT DONE** (owner chose to skip the console step "on my responsibility"). Requires Supabase rotation + Railway env.
2. **Old credential invalidation** — ⛔ not done (rotation pending).
3. **Hard-coded / fallback secret removal** — ⛔ not done. Removing the inline DB fallback blindly would crash production if Railway lacks `DATABASE_URL`; requires owner to set env first. **Fallback intentionally left intact to avoid an outage.**
4. **Supabase backup** — owner action (recommended before rotation).
5. **synchronize current state** — still `true` (unchanged).
6. **Migration foundation** — documented (`FINAL_DB_SCHEMA_BASELINE.md`); **needs a staging/preview DB** to generate + test a baseline migration.
7. **synchronize=false production validation** — ⛔ not done (blocked on staging DB; blind cutover forbidden by spec).
8. **CORS hardening** — ✅ **DONE + verified live**: `origin:true` → explicit allowlist (prod frontend + this project's Vercel preview pattern + localhost + optional `FRONTEND_ORIGINS`). Allowed origins get ACAO; **evil origin blocked**; non-browser requests still work.
9. **JWT review + hardening** — ✅ **DONE + verified** (`2e0c19c8`). `JwtStrategy.validate` now looks up the user per request, **rejects deleted/inactive accounts (global)**, and returns fresh role/identity (revocation + role changes take effect). Secret env-only (`JWT_SECRET`), HS256, ~8h expiry. Verified: valid token still authenticates across all modules (200); anonymous 401. No refresh token / localStorage JWT = documented future.
10. **Inactive/deleted user handling** — ✅ **global** (JwtStrategy) + AI endpoints.
11. **localStorage risk** — documented: JWT in localStorage is XSS-exposable. HttpOnly-cookie migration is a larger auth redesign → **future** (not forced into this phase).
12. **Task AI authentication** — ✅ (JWT, from hotfix) + ✅ **`tasks` screen authorization** (this phase).
13. **Invoice AI authorization** — ✅ JWT + **`invoices` screen**.
14. **Fleet AI authorization** — ✅ JWT + **`vessels` OR `reports` screen**.
15. **Invoice extraction security** — ✅ JWT + `invoices` screen; 10MB limit; treats document as untrusted; **removed response-preview logging** of extracted content.
16. **AI write-action safety** — legacy task/invoice assistants can still write (approved existing behavior) but now: authenticated + screen-authorized + field-whitelisted + typed params + no SQL. Ask UME remains **read-only**. Recommendation (documented): add an explicit user-confirmation gate before AI write actions — **future**.
17. **API authorization audit** — ✅ `FINAL_API_AUTHORIZATION_AUDIT.md` (A/B/C/D). AI endpoints → A. **Centralized `ScreenGuard` + `@RequireScreen` built and applied to `payments` (payments screen) and `tasks` (tasks screen)** — the two most sensitive modules with no cross-fetch conflict (verified: authorized user 200, anon 401). Remaining CRUD → B (JWT-only); blanket enforcement deferred (would break legitimate cross-screen fetches, e.g. Reports loading vessel/supplier name lists). `/api/auth/seed` flagged for review.
18. **Secrets audit** — ⚠️ **P0 DISCOVERED:** `attachments.service.ts` contains a **hardcoded Supabase `service_role` key** (+ project URL) in source/git history — full DB/storage access, bypasses RLS. Also the known DB password fallback in `app.module.ts`. No `sk-ant`/JWT elsewhere; no `.env` tracked; Anthropic key is `process.env` only.
19. **Logging audit** — ✅ removed extract financial-content preview log. No JWT/keys/DB creds logged. Assistant errors log message/status only.
20. **Dependency review** — backend 3 high; frontend 6 (1 moderate, 5 high, incl. sharp/libvips CVEs). **Not blanket-upgraded** (regression risk on live financial system); documented for a controlled maintenance window.
21. **Financial workflow debt plan** — ✅ `FINANCIAL_WORKFLOW_REMEDIATION_PLAN.md` (not executed).
22. **Backend regression** — ✅ app boots healthy with new DI; guarded endpoints 401 anon.
23. **Frontend regression** — ✅ unaffected (frontend not changed this phase).
24. **Ask UME regression** — ✅ still works + permission-safe.
25. **Financial golden regression** — ✅ unchanged (no business-logic/data change; earlier golden tests still valid).
26. **Database integrity** — ✅ no schema/data change performed.
27. **P0** — **2 open:** (a) hardcoded `service_role` key in source/history; (b) hardcoded DB password fallback + un-rotated DB credential.
28. **P1** — remaining CRUD endpoints authenticated-only (broad module-authz deferred to avoid cross-fetch regressions; centralized guard now available for controlled rollout). (Global JWT inactive-user rejection — now resolved.)
29. **P2** — dependency vulns (documented); `/api/auth/seed` public.
30. **P3** — localStorage JWT (accepted/future).
31. **Remaining accepted risks / deferred** — DB rotation + fallback removal (owner console), `service_role` key externalize + **rotate** (owner console), synchronize:false cutover (staging DB), global JWT hardening, broad endpoint authz, dependency upgrades, cookie migration, AI-write confirmation gate.
32. **Production status** — backend `8acdb2e8` live (CORS + AI authz). No outage.
33. **Rollback readiness** — ✅ `e096dfbf` / `4d641086`; no history rewrite; no secrets in docs.

## Acceptance requirements vs actual
| Required | Status |
|---|---|
| Old DB credential invalid | ❌ not rotated (owner deferred) |
| No active hard-coded DB password | ❌ fallback intact (removal needs Railway env first) |
| No active production DB fallback | ❌ intact |
| synchronize no longer controls schema | ❌ still true (needs staging) |
| Migration strategy operational | ⚠️ documented, not built (needs staging) |
| CORS not arbitrary | ✅ |
| Sensitive AI endpoints authenticated | ✅ |
| Module-sensitive AI access permission-aware | ✅ |
| Ask UME permission-safe | ✅ |
| JWT rejects deleted/inactive users | ✅ (global) |
| Payments/Tasks module-authorized | ✅ |
| No secrets committed | ❌ **P0 service_role key + DB password in source (rotation deferred by owner to project end)** |
| No P0 security defects | ❌ 2 open (credential exposure — deferred to last) |
| Financial calculations unchanged | ✅ |

## Owner decision recorded
Owner directed: **defer all credential rotation (DB password + Supabase service_role) to the very last step of the project**, and complete every other pending item first. All executable code-side hardening is now **done, deployed, and verified**. The two open P0s and the `synchronize:false` cutover remain **by that decision / infra dependency**, not for lack of work.

## Owner actions required to reach GO
1. **Rotate the Supabase `service_role` key** (Supabase → API settings) — the exposed one must be invalidated; then set `SUPABASE_URL` + `SUPABASE_SERVICE_KEY` in Railway so I can externalize `attachments.service.ts`.
2. **DB rotation:** set Railway `DATABASE_URL` (current pw) → I remove the fallback + fail-safe → you rotate the pw in Supabase → update Railway.
3. **Provide a staging/preview DB** for the synchronize:false baseline-migration cutover.

## Result
`NO-GO — Security hardening requires remediation`
(CORS + AI authorization + logging + audits/plans done and live; **DB credential rotation, service_role key rotation/externalization, and synchronize cutover remain — all blocked on owner Supabase/Railway console actions.**)
