# SECURITY FIX — Database Secret Externalization (P0)

Controlled backend security change. **No secret values are recorded in this document.**

## What was changed
- `src/app.module.ts` TypeORM config now reads the connection from environment variables:
  - Preferred: **`DATABASE_URL`** (full Postgres connection string).
  - Optional discrete alternative: `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`.
- A temporary fallback to the previous inline values is retained **only** to guarantee zero downtime until the Railway variable is confirmed. It will be removed in a follow-up commit after verification + password rotation.
- **No** schema / entity / table / RLS / trigger / function / business-logic changes. `synchronize: true` was **not** touched (tracked separately as P0 tech debt).

## Environment variable NAME (value never documented)
- `DATABASE_URL`  ← set this in Railway to the Supabase Postgres connection string.

## Rollout sequence (safe ordering)
1. ✅ Deploy env-based config **with fallback** (this commit) — behavior unchanged whether or not the var is set.
2. ⏳ **[USER — Railway]** Add `DATABASE_URL` (current credentials) → redeploy → verify backend connects via the variable.
3. ⏳ **[USER — Supabase]** Rotate the database password.
4. ⏳ **[USER — Railway]** Update `DATABASE_URL` with the rotated credential → redeploy.
5. ⏳ **[CODE]** Remove the inline fallback (follow-up commit) once the variable is confirmed working.
6. ⏳ Confirm the previously committed password is now **invalid**.

## Verification checklist (to be completed with the user)
- [ ] Backend starts successfully after `DATABASE_URL` is set
- [ ] Database connection succeeds (login / any DB-backed endpoint responds)
- [ ] Authentication works (JWT login)
- [ ] Existing API endpoints respond normally
- [ ] Password rotated in Supabase
- [ ] Railway updated with rotated credential
- [ ] Old committed password confirmed invalid

## Notes
- Git history rewrite: **not performed at this stage** (per instruction). The committed secret is neutralized by rotation (step 3).
- Affected commit hash (env-based config): _<filled after push>_
