-- ══════════════════════════════════════════════════════════════════
-- محرّك إطفاء المصروفات المدفوعة مقدماً — هجرة القاعدة
--
-- ينفّذها المالك في محرّر Supabase. لا يُنفّذها التطبيق: الإنتاج على
-- synchronize=false و migrationsRun=false عمداً.
--
-- آمنة للتكرار: كل عبارة IF NOT EXISTS أو DROP ثم ADD.
-- ══════════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE journal_entries DROP CONSTRAINT IF EXISTS chk_je_event_type;

ALTER TABLE journal_entries ADD CONSTRAINT chk_je_event_type CHECK (
     accounting_event_type IN (
       'manual','opening_balance','invoice_accrual','payment_settlement',
       'reversal','adjustment','depreciation','fx_revaluation','amortization'));

CREATE TABLE IF NOT EXISTS prepaid_schedules (
     id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     legal_entity_id       UUID NOT NULL,
     vessel_id             UUID,
     customer_id           UUID,
     description           VARCHAR(300),
     source_reference      VARCHAR(100),
     total_amount          NUMERIC(18,2) NOT NULL,
     start_month           CHAR(7) NOT NULL,
     end_month             CHAR(7) NOT NULL,
     prepaid_account_id    UUID NOT NULL,
     expense_account_id    UUID NOT NULL,
     journal_code          VARCHAR(10) NOT NULL DEFAULT 'GJ',
     is_active             BOOLEAN NOT NULL DEFAULT true,
     created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
     updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
     created_by            UUID
   );

ALTER TABLE prepaid_schedules DROP CONSTRAINT IF EXISTS chk_ps_amount;

ALTER TABLE prepaid_schedules ADD CONSTRAINT chk_ps_amount CHECK (total_amount > 0);

ALTER TABLE prepaid_schedules DROP CONSTRAINT IF EXISTS chk_ps_months;

ALTER TABLE prepaid_schedules ADD CONSTRAINT chk_ps_months CHECK (
     start_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'
     AND end_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'
     AND end_month >= start_month);

ALTER TABLE prepaid_schedules DROP CONSTRAINT IF EXISTS fk_ps_entity;

ALTER TABLE prepaid_schedules ADD CONSTRAINT fk_ps_entity
     FOREIGN KEY (legal_entity_id) REFERENCES legal_entities(id) ON DELETE RESTRICT;

ALTER TABLE prepaid_schedules DROP CONSTRAINT IF EXISTS fk_ps_prepaid;

ALTER TABLE prepaid_schedules ADD CONSTRAINT fk_ps_prepaid
     FOREIGN KEY (prepaid_account_id) REFERENCES accounting_accounts(id) ON DELETE RESTRICT;

ALTER TABLE prepaid_schedules DROP CONSTRAINT IF EXISTS fk_ps_expense;

ALTER TABLE prepaid_schedules ADD CONSTRAINT fk_ps_expense
     FOREIGN KEY (expense_account_id) REFERENCES accounting_accounts(id) ON DELETE RESTRICT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_ps_active_reference
     ON prepaid_schedules (legal_entity_id, source_reference) WHERE is_active;

CREATE INDEX IF NOT EXISTS ix_ps_entity_active
     ON prepaid_schedules (legal_entity_id) WHERE is_active;

ALTER TABLE prepaid_schedules ENABLE ROW LEVEL SECURITY;

DO $rev$
   DECLARE r text;
   BEGIN
     FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
       IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
         EXECUTE format('REVOKE ALL ON TABLE prepaid_schedules FROM %I', r);
       END IF;
     END LOOP;
   END $rev$;

COMMIT;
