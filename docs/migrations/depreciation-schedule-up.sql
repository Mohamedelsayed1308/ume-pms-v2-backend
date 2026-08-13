-- DEPRECIATION SCHEDULE — UP
BEGIN;

CREATE TABLE IF NOT EXISTS depreciation_schedules (
     id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     legal_entity_id          UUID NOT NULL,
     vessel_id                UUID NOT NULL,
     description              VARCHAR(200),
     monthly_amount           NUMERIC(18,2) NOT NULL,
     start_month              CHAR(7) NOT NULL,
     end_month                CHAR(7) NOT NULL,
     expense_account_id       UUID NOT NULL,
     accumulated_account_id   UUID NOT NULL,
     cost_account_id          UUID,
     journal_code             VARCHAR(10) NOT NULL DEFAULT 'GJ',
     is_active                BOOLEAN NOT NULL DEFAULT true,
     created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
     updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
     created_by               UUID
   );

ALTER TABLE depreciation_schedules DROP CONSTRAINT IF EXISTS chk_ds_amount;

ALTER TABLE depreciation_schedules ADD CONSTRAINT chk_ds_amount CHECK (monthly_amount > 0);

ALTER TABLE depreciation_schedules DROP CONSTRAINT IF EXISTS chk_ds_months;

ALTER TABLE depreciation_schedules ADD CONSTRAINT chk_ds_months CHECK (
     start_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'
     AND end_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'
     AND end_month >= start_month);

ALTER TABLE depreciation_schedules DROP CONSTRAINT IF EXISTS fk_ds_entity;

ALTER TABLE depreciation_schedules ADD CONSTRAINT fk_ds_entity
     FOREIGN KEY (legal_entity_id) REFERENCES legal_entities(id) ON DELETE RESTRICT;

ALTER TABLE depreciation_schedules DROP CONSTRAINT IF EXISTS fk_ds_expense;

ALTER TABLE depreciation_schedules ADD CONSTRAINT fk_ds_expense
     FOREIGN KEY (expense_account_id) REFERENCES accounting_accounts(id) ON DELETE RESTRICT;

ALTER TABLE depreciation_schedules DROP CONSTRAINT IF EXISTS fk_ds_accumulated;

ALTER TABLE depreciation_schedules ADD CONSTRAINT fk_ds_accumulated
     FOREIGN KEY (accumulated_account_id) REFERENCES accounting_accounts(id) ON DELETE RESTRICT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_ds_active_vessel
     ON depreciation_schedules (legal_entity_id, vessel_id) WHERE is_active;

ALTER TABLE depreciation_schedules ENABLE ROW LEVEL SECURITY;

DO $rev$
   DECLARE r text;
   BEGIN
     FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
       IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
         EXECUTE format('REVOKE ALL ON depreciation_schedules FROM %I', r);
       END IF;
     END LOOP;
   END $rev$;

COMMIT;
