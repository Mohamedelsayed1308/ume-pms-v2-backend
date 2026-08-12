-- ═══ GUBAL FOUNDATION — DOWN ═══
BEGIN;

DROP TRIGGER IF EXISTS trg_receipt_immutable ON goods_service_receipts;

DROP FUNCTION IF EXISTS goods_receipt_immutable();

DROP TABLE IF EXISTS goods_service_receipts;

DROP TRIGGER IF EXISTS trg_fx_immutable ON accounting_fx_rates;

DROP FUNCTION IF EXISTS accounting_fx_immutable();

ALTER TABLE accounting_fx_rates DROP CONSTRAINT IF EXISTS chk_fx_no_self_approval;

ALTER TABLE accounting_fx_rates DROP CONSTRAINT IF EXISTS chk_fx_approval_pairing;

DO $rollback$
   DECLARE drafts int;
   BEGIN
     SELECT COUNT(*) INTO drafts
       FROM accounting_fx_rates
      WHERE source = 'MANUAL_APPROVED' AND approved_by IS NULL;

     IF drafts > 0 THEN
       RAISE EXCEPTION 'التراجع متوقّف: % سعر صرف يدوي بحالة مسوّدة أنشأته القواعد الجديدة. اعتمدها أو احذفها أولاً، فالقيد القديم لا يقبل سعراً يدوياً بلا معتمِد.', drafts;
     END IF;

     ALTER TABLE accounting_fx_rates ADD CONSTRAINT chk_fx_manual_approved CHECK (
       source <> 'MANUAL_APPROVED' OR approved_by IS NOT NULL);
   END $rollback$;

UPDATE accounting_accounts SET currency_restriction = NULL, updated_at = now()
     WHERE code = '1010' AND currency_restriction = 'EUR';

COMMIT;
