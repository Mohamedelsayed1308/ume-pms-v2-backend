-- ═══ GUBAL FOUNDATION — UP ═══
BEGIN;

ALTER TABLE accounting_fx_rates DROP CONSTRAINT IF EXISTS chk_fx_manual_approved;

ALTER TABLE accounting_fx_rates DROP CONSTRAINT IF EXISTS chk_fx_approval_pairing;

ALTER TABLE accounting_fx_rates ADD CONSTRAINT chk_fx_approval_pairing CHECK (
     (approved_by IS NULL AND approved_at IS NULL)
     OR (approved_by IS NOT NULL AND approved_at IS NOT NULL));

ALTER TABLE accounting_fx_rates DROP CONSTRAINT IF EXISTS chk_fx_no_self_approval;

ALTER TABLE accounting_fx_rates ADD CONSTRAINT chk_fx_no_self_approval CHECK (
     approved_by IS NULL OR created_by IS NULL OR approved_by <> created_by);

CREATE OR REPLACE FUNCTION accounting_fx_immutable() RETURNS TRIGGER AS $fx$
   DECLARE used boolean;
   BEGIN
     SELECT EXISTS (
       SELECT 1 FROM journal_lines jl
         JOIN journal_entries je ON je.id = jl.entry_id
        WHERE jl.fx_rate_id = OLD.id
          AND je.status IN ('posted','reversed')
     ) INTO used;

     -- فرعان صريحان: NEW غير مُسنَد في DELETE، و COALESCE على نوع سجلّ فخّ.
     IF NOT used THEN
       IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
     END IF;

     IF TG_OP = 'DELETE' THEN
       RAISE EXCEPTION 'سعر صرف مستخدَم في قيد مُرحَّل لا يُحذف (%)', OLD.id;
     END IF;

     IF NEW.rate IS DISTINCT FROM OLD.rate
        OR NEW.rate_date IS DISTINCT FROM OLD.rate_date
        OR NEW.source IS DISTINCT FROM OLD.source
        OR NEW.currency_from IS DISTINCT FROM OLD.currency_from
        OR NEW.currency_to IS DISTINCT FROM OLD.currency_to
        OR NEW.legal_entity_id IS DISTINCT FROM OLD.legal_entity_id
     THEN
       RAISE EXCEPTION 'سعر صرف مستخدَم في قيد مُرحَّل لا يقبل تعديل القيمة أو التاريخ أو المصدر أو الزوج (%)', OLD.id;
     END IF;

     -- بيانات وصفية غير مؤثّرة (source_reference · الاعتماد) تبقى قابلة للتحديث.
     RETURN NEW;
   END; $fx$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_fx_immutable ON accounting_fx_rates;

CREATE TRIGGER trg_fx_immutable BEFORE UPDATE OR DELETE ON accounting_fx_rates
     FOR EACH ROW EXECUTE FUNCTION accounting_fx_immutable();

DO $bank$
   DECLARE offending int;
   BEGIN
     SELECT COUNT(*) INTO offending
       FROM journal_lines jl
       JOIN accounting_accounts a ON a.id = jl.account_id
      WHERE a.code = '1010' AND jl.transaction_currency <> 'EUR';

     IF offending > 0 THEN
       RAISE EXCEPTION 'يوجد % سطر بغير اليورو على الحساب 1010 — لا يُطبَّق التقييد', offending;
     END IF;

     UPDATE accounting_accounts
        SET currency_restriction = 'EUR', updated_at = now()
      WHERE code = '1010' AND currency_restriction IS DISTINCT FROM 'EUR';
   END $bank$;

CREATE TABLE IF NOT EXISTS goods_service_receipts (
     id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     invoice_id        UUID NOT NULL,
     receipt_type      VARCHAR(40) NOT NULL,
     received_date     DATE NOT NULL,
     received_by       UUID,
     received_by_name  VARCHAR(200),
     reference         VARCHAR(200),
     notes             VARCHAR(500),
     attachment_id     UUID,
     is_partial        BOOLEAN NOT NULL DEFAULT false,
     created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
     created_by        UUID
   );

ALTER TABLE goods_service_receipts DROP CONSTRAINT IF EXISTS chk_receipt_type;

ALTER TABLE goods_service_receipts ADD CONSTRAINT chk_receipt_type CHECK (
     receipt_type IN ('GOODS_RECEIVED', 'SERVICE_CONFIRMED', 'MANAGEMENT_RECEIPT_CONFIRMATION'));

ALTER TABLE goods_service_receipts DROP CONSTRAINT IF EXISTS fk_receipt_invoice;

ALTER TABLE goods_service_receipts ADD CONSTRAINT fk_receipt_invoice
     FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS ix_receipt_invoice ON goods_service_receipts (invoice_id);

CREATE INDEX IF NOT EXISTS ix_receipt_date ON goods_service_receipts (received_date);

CREATE OR REPLACE FUNCTION goods_receipt_immutable() RETURNS TRIGGER AS $rc$
   BEGIN
     IF TG_OP = 'DELETE' THEN
       RAISE EXCEPTION 'واقعة استلام مسجَّلة لا تُحذف — سجّل واقعة مصحِّحة بدلاً منها (%)', OLD.id;
     END IF;
     IF (to_jsonb(NEW) - 'notes') <> (to_jsonb(OLD) - 'notes') THEN
       RAISE EXCEPTION 'واقعة استلام مسجَّلة لا تُعدَّل عدا الملاحظات (%)', OLD.id;
     END IF;
     RETURN NEW;
   END; $rc$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_receipt_immutable ON goods_service_receipts;

CREATE TRIGGER trg_receipt_immutable BEFORE UPDATE OR DELETE ON goods_service_receipts
     FOR EACH ROW EXECUTE FUNCTION goods_receipt_immutable();

ALTER TABLE goods_service_receipts ENABLE ROW LEVEL SECURITY;

DO $rev$
   DECLARE r text;
   BEGIN
     FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
       IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
         EXECUTE format('REVOKE ALL ON goods_service_receipts FROM %I', r);
       END IF;
     END LOOP;
   END $rev$;

COMMIT;
