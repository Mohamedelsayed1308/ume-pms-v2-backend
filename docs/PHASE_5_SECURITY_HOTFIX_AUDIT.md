# PHASE 5 — PRE-MVP SECURITY HOTFIX — AUDIT

Repo: `ume-pms-v2` (backend, Railway from `main`). Scope: **authentication hotfix only** — add the existing `JwtAuthGuard` to endpoint groups discovered without any guard. No business logic / schema / payload / behavior change.

## Finding
No global `APP_GUARD` exists. Guard coverage was verified across all controllers: every controller uses `@UseGuards(JwtAuthGuard)` **except** the three below, which are fully anonymous (authentication missing).

## Unprotected routes

### `TasksController` — `@Controller('api/tasks')` — NO GUARD
| Method | Route | R/W | Severity |
|---|---|---|---|
| GET | `/api/tasks` | read | P0 (data exposure) |
| GET | `/api/tasks/:id` | read | P0 |
| POST | `/api/tasks` | **write** | P0 |
| PUT | `/api/tasks/:id` | **write** | P0 |
| DELETE | `/api/tasks/:id` | **write** | P0 |
| POST | `/api/tasks/:id/comments` | **write** | P0 |
| DELETE | `/api/tasks/comments/:commentId` | **write** | P0 |

### `TasksAssistantController` — `@Controller('api/tasks')` — NO GUARD
| Method | Route | R/W | Severity |
|---|---|---|---|
| POST | `/api/tasks/assistant` | **write via LLM tools** (create/update task, add comment) + sends all-tasks snapshot to Anthropic | **P0** |

### `ProfitPeriodsController` — `@Controller('api/profit-periods')` — NO GUARD
| Method | Route | R/W | Severity |
|---|---|---|---|
| GET | `/api/profit-periods` | read | P1 |
| GET | `/api/profit-periods/voyage-dates` | read | P1 |
| GET | `/api/profit-periods/:id` | read | P1 |
| GET | `/api/profit-periods/:id/calculate` | read (compute) | P1 |
| POST | `/api/profit-periods` | **write** | P1 |
| PUT | `/api/profit-periods/:id` | **write** | P1 |
| DELETE | `/api/profit-periods/:id` | **write** | P1 |
| POST | `/api/profit-periods/fetch-excel` | read (external fetch) | P1 |

## Proposed protection
Apply the project's existing `JwtAuthGuard` (`src/common/jwt-auth.guard.ts`, `AuthGuard('jwt')`) at **class level** on all three controllers (same pattern as `FleetController`, `InvoicesController`, etc.). Import path from `src/modules/<x>/`: `../../common/jwt-auth.guard`.

## Safety analysis
- The frontend calls all these routes through `@/lib/api` (axios), whose request interceptor attaches `Authorization: Bearer <token>` to **every** request. Therefore adding the guard does **not** break the frontend — authenticated calls keep working; only anonymous callers are blocked (the goal).
- Callers confirmed: `app/dashboard/tasks/*`, `app/dashboard/page.tsx`, `TaskAssistant.tsx` (tasks); `app/dashboard/profit-distribution/page.tsx` (profit-periods).
- No payload/schema/behavior change; assistant tool whitelist unchanged.

## Authentication vs authorization (explicit)
This hotfix restores **authentication** (a valid JWT is required). It does **not** add fine-grained `allowed_screens` authorization — that is deliberately deferred to the Ask UME server-side permission enforcement (Phase 5 architecture, Design 1). Documented so no false "fully authorized" claim is made.

## Secrets
No secrets referenced or exposed by this change.
