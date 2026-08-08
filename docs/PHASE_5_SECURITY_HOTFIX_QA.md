# PHASE 5 — SECURITY HOTFIX QA (authentication)

Repo: `ume-pms-v2`. Change: add existing `JwtAuthGuard` (class-level) to `TasksController`, `TasksAssistantController`, `ProfitPeriodsController`. **Authentication only** — no logic/schema/payload/behavior change; assistant tool whitelist unchanged.

## Deploy references
| Item | Value |
|------|-------|
| Backend production HEAD (merge) | `a9abf3e9` |
| Previous backend HEAD | `5c42fd47` |
| Branch | `security/auth-hotfix` → `main` (`--no-ff`) |
| Deploy | Railway from `main` (auto) |
| Frontend | unchanged (already sends JWT on every request) |
| Database | no change |

## Before fix (verified live, anonymous)
`GET /api/tasks` → **200** · `GET /api/profit-periods` → **200** · `POST /api/tasks/assistant` → reached handler (400 validation, past auth). Vulnerability confirmed.

## After fix — negative tests (anonymous, no token)
Real HTTP status line verified with `curl -i -H 'Expect:'` (note: curl's `%{http_code}` reports `400` for POSTs with a body due to an `Expect: 100-continue` proxy artifact; the actual response line and body are 401).
| Route | Method | Result |
|---|---|---|
| /api/tasks | GET | **401** ✅ |
| /api/tasks | POST | **401** ✅ (`HTTP/1.1 401 Unauthorized`, body `{"statusCode":401}`) |
| /api/tasks/:id | PUT | **401** ✅ |
| /api/tasks/:id | DELETE | **401** ✅ |
| /api/tasks/:id/comments | POST | **401** ✅ |
| /api/tasks/assistant | POST | **401** ✅ |
| /api/profit-periods | GET | **401** ✅ |
| /api/profit-periods | POST | **401** ✅ |
| /api/suppliers (control, already guarded) | GET | 401 ✅ |

## After fix — positive tests (valid JWT, run in-browser so token never left the browser)
| Test | Result |
|---|---|
| GET /api/tasks | 200 · count 3 |
| POST /api/tasks (disposable QA) | 201 |
| PUT /api/tasks/:id | 200 |
| POST /api/tasks/:id/comments | 201 |
| DELETE /api/tasks/:id | 200 |
| Count after cleanup | 3 (restored, no residue) |
| GET /api/profit-periods | 200 |
| Authenticated task assistant | endpoint now requires JWT (anonymous 401 confirmed); authenticated write-path not exercised to avoid AI-driven writes |

## Frontend regression (production, authenticated)
| Item | Result |
|---|---|
| Team Tasks page | ✅ loads (no login redirect), count 3, Kanban works |
| Profit-distribution page + `/api/profit-periods` | ✅ loads, API 200 |
| Notifications | ✅ All(57)/Tasks(3)/Fleet(3), task alerts present |
| Global Search task result | ✅ "American" task found |
| Console | ✅ no errors |

## Report
1. Unprotected routes discovered: tasks (7), tasks/assistant (1), profit-periods (8) — all anonymous.
2. Routes protected: all of the above (class-level guard).
3. Guard used: existing `JwtAuthGuard` (`AuthGuard('jwt')`).
4. Unauthenticated GET: **401** · 5. Unauthenticated POST: **401** · 6. Unauthenticated assistant: **401** · 7. Unauthenticated profit-period: **401**.
8. Authenticated tasks read: ✅ 200 (3) · 9. Authenticated CRUD: ✅ 201/200/201/200 · 10. Comment flow: ✅ · 11. Assistant: now JWT-required (auth enforced) · 12. Profit-period regression: ✅ · 13. Notifications regression: ✅ · 14. Search regression: ✅ · 15. Reports regression: ✅ · 16. Task count cleanup: ✅ (3) · 17. Console/network: ✅ clean.
18. **P0: 0 remaining** (authentication gap closed) · 19. P1: 0 · 20. P2: 0 · 21. P3: 0.
22. Backend production: ✅ deployed (`a9abf3e9`), fix live. 23. Frontend production: ✅ unchanged, works. 24. Database: ✅ no change.

## Note (authentication vs authorization)
This closes the **authentication** gap (valid JWT now required). Fine-grained `allowed_screens` **authorization** is intentionally deferred to Ask UME server-side enforcement (Phase 5 architecture). No false "fully authorized" claim.

**GO — P0 authentication vulnerability remediated**
