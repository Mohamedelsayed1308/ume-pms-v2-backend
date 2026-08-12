-- ═══ GUBAL FX — DROP TWO-PERSON APPROVAL — UP ═══
BEGIN;

ALTER TABLE accounting_fx_rates DROP CONSTRAINT IF EXISTS chk_fx_no_self_approval;

COMMIT;
