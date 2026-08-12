-- ACCOUNTING SCOPE — DOWN
BEGIN;

ALTER TABLE shipping_companies DROP CONSTRAINT IF EXISTS fk_sc_legal_entity;

DROP INDEX IF EXISTS ix_sc_legal_entity;

ALTER TABLE shipping_companies DROP COLUMN IF EXISTS legal_entity_id;

COMMIT;
