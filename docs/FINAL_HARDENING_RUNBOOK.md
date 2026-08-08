# FINAL HARDENING — EXECUTION RUNBOOK (remaining items)

Three remaining items, each sequenced to avoid downtime. **[YOU]** = Supabase/Railway console (credentials — I cannot do these). **[ME]** = code + deploy + verify. Do the parts **in order**. Never paste secret values into chat/docs/commits.

Current production: backend `e3121a45` (Railway from `main`). Rollback tags/commits noted per part.

---

## PART A — Rotate + externalize the Supabase `service_role` key (P0)
The key is hardcoded in `src/modules/attachments/attachments.service.ts` and in git history → full DB/storage access (bypasses RLS). Highest priority.

**A1. [ME]** Change `attachments.service.ts` to read `SUPABASE_URL` + `SUPABASE_SERVICE_KEY` from env, **no fallback** (throws if missing). Commit on a branch, do **not** deploy yet.

**A2. [YOU] — Railway → backend service → Variables:** add
```
SUPABASE_URL           = https://euzikjnyoprzkweechky.supabase.co
SUPABASE_SERVICE_KEY   = <the CURRENT service_role key from Supabase → Project Settings → API>
```
Save (don't redeploy manually yet — the next deploy picks them up).

**A3. [ME]** Deploy the A1 change. **Verify:** open an invoice with an attachment (upload a small test file, confirm it appears, then delete it). If attachments work → env is used, hardcoded key no longer in active source.

**A4. [YOU] — Supabase → Project Settings → API keys:** **rotate/roll the `service_role` key** (or "Roll JWT secret" if your project only offers that — it regenerates the service/anon keys). This **invalidates the exposed key**. Copy the **new** service_role key.

**A5. [YOU] — Railway:** update `SUPABASE_SERVICE_KEY` = the **new** key → redeploy.

**A6. [ME]** Re-verify attachments upload/list/delete with the new key. ✅ Old (exposed) key is now dead.

- **Rollback (A):** if attachments break after A3, revert the A1 commit (restores hardcoded key temporarily) and redeploy; re-check Railway vars.
- **Future:** consider replacing `service_role` with a least-privilege key + storage RLS policies (separate task).

---

## PART B — Rotate the database password + remove the code fallback
`src/app.module.ts` has an inline DB password fallback. Remove it safely, then rotate.

**B1. [YOU] — Railway → Variables:** set
```
DATABASE_URL = postgresql://postgres.euzikjnyoprzkweechky:<CURRENT-DB-PASSWORD>@aws-0-eu-west-1.pooler.supabase.com:5432/postgres
```
(the **current** password — the connection string from Supabase → Connect → Session/Transaction pooler). Redeploy. The app now runs from env (same value as the fallback → zero behavior change).

**B2. [YOU] — Supabase (recommended):** take a **backup/snapshot** of the database before rotating (rotation doesn't touch data, but this is the safety net).

**B3. [ME]** Remove the inline fallback + `DB_*` default host/user/pass in `app.module.ts`; make the factory **throw** if neither `DATABASE_URL` nor a full `DB_*` set is present (fail-safe). Deploy. **Verify:** backend boots, DB connects, login works, Ask UME works, core APIs return data. (If it crashes → `DATABASE_URL` on Railway is wrong → revert this commit to restore the fallback, fix the var, retry.)

**B4. [YOU] — Supabase → Database → Settings:** **reset the database password** (generate a new one). Then update Railway `DATABASE_URL` with the **new** password → redeploy.

**B5. [ME]** Verify backend connects with the new password (login + a core API). ✅ Old password invalid; no hardcoded secret in active source.

- **Rollback (B):** if B3 crashes the app, `git revert` the removal commit + redeploy (fallback returns) while you fix the Railway var. Recovery commit before B: `e3121a45`.
- **Git history:** the old password/key remain in history but are now **invalid** after rotation. Optional repo-history scrub (BFG/filter-repo) = separate optional hygiene task; not required once rotated.

---

## PART C — Turn off `synchronize:true` (controlled migration)
Must not be switched blindly on the live financial DB. Needs a staging copy.

**C1. [YOU]** Provide a **staging/preview Postgres** (NOT production): a Supabase branch, or restore a snapshot into a separate project. Give me its `DATABASE_URL` (I'll use it only for the staging run).

**C2. [ME]** Add a TypeORM DataSource + migration scripts. Run `migration:generate` **against staging**:
- If empty/no-op → schema already matches entities → create a **baseline** migration (no table rebuild, no drops).
- If it has changes → inspect every statement; ensure **no DROP/RENAME** of existing columns/tables.

**C3. [ME]** On **staging**: set `synchronize:false`, run the migration, boot the app, run CRUD + the financial golden tests, confirm **no schema mutation on startup**.

**C4. [ME]** Only after staging passes: set **production** `synchronize:false` + deploy with the baseline migration history. Verify boot + CRUD + golden tests. (Migrations, not auto-sync, govern schema from here on.)

- **Rollback (C):** revert to `synchronize:true` commit + redeploy (immediately restores prior behavior; no data change was made).

---

## Final gate after A + B + C
When A, B, C are done and verified, the mandatory acceptance criteria are met (old credentials invalid, no hardcoded secrets, `synchronize:false`), and I update `FINAL_SECURITY_HARDENING_QA.md` → **GO**.

## Optional remaining (lower priority, no console needed)
- Global JWT: ✅ already done. Broad endpoint authz beyond payments/tasks: controlled rollout with the ready `ScreenGuard`.
- `/api/auth/seed`: restrict/remove after bootstrap.
- Dependency upgrades (backend 3 high / frontend 6): controlled maintenance window.
- AI write-action confirmation gate; localStorage→cookie auth: future.
