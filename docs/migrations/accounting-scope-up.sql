-- ACCOUNTING SCOPE — UP
BEGIN;

ALTER TABLE shipping_companies ADD COLUMN IF NOT EXISTS legal_entity_id UUID;

ALTER TABLE shipping_companies DROP CONSTRAINT IF EXISTS fk_sc_legal_entity;

ALTER TABLE shipping_companies ADD CONSTRAINT fk_sc_legal_entity
     FOREIGN KEY (legal_entity_id) REFERENCES legal_entities(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS ix_sc_legal_entity ON shipping_companies (legal_entity_id);

COMMIT;
