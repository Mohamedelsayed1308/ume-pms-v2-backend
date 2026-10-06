-- ============================================================================
--  هجرة: تطبيق الإشعارات الدائنة على فواتير المورّد
--  جدولٌ واحدٌ جديد  ·  بأمر المالك في ٦ أكتوبر ٢٠٢٦
--
--  لماذا
--  -----
--  المورّد يُصدر إشعاراً دائناً (فاتورةً سالبة)، والمالك يخصمه من مبلغ التحويل.
--  ولا يُسجَّل ذلك سداداً سالباً: كلّ سدادٍ يُرحَّل قيداً على البنك، ومحرّك القيود
--  يرفض المبلغ السالب، ولو لم يُرحَّل لقيّد البنكُ مجموع الفواتير كاملةً لا المحوَّل.
--
--  فالتصميم: الدفعة النقديّة تُسجَّل بما حُوّل فعلاً، والإشعار الدائن يُطبَّق على
--  الفاتورة سطراً هنا — تسويةٌ داخل حساب المورّد لا تمسّ البنك. والفاتورة تُغلق
--  بما سُدّد نقداً وما طُبّق عليها، والإشعار يُغلق حين يُستنفد رصيده.
--
--  الأمان
--  ------
--  إنشاءٌ محض: جدولٌ جديد، ولا صفّ يُكتب، ولا جدولٌ قائمٌ يُمسّ.
--  متكرّرة الأمان: `IF NOT EXISTS`، والقيود بأسمائها تُفحص قبل الإضافة.
--  المفتاحان الأجنبيّان `ON DELETE RESTRICT`: لا تُحذف فاتورةٌ أو إشعارٌ طُبّق عليه.
--  RLS بلا سياسات وسحب الصلاحيّات من أدوار Supabase المباشرة؛ الباك يتّصل بدور
--  مالك الجدول فلا تمسّه (بلا FORCE).
--
--  الترتيب: هذه الهجرة ← تحقّق ← نشر الباك ← نشر الواجهة. الباك يقرأ هذا الجدول
--  عند كلّ إعادة حسابٍ لحالة فاتورة، فنشرُه قبل الهجرة يُسقط تسجيل الدفعات.
--
--  التشغيل:  node scripts/run-migration.js docs/credit-note-allocations-up.sql
--  التراجع:  docs/credit-note-allocations-down.sql
-- ============================================================================

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.invoices') IS NULL THEN
    RAISE EXCEPTION 'GATE FAILED: جدول invoices غير موجود';
  END IF;
  RAISE NOTICE 'قبل الهجرة: credit_note_allocations %',
    CASE WHEN to_regclass('public.credit_note_allocations') IS NULL THEN 'غير موجود — يُنشأ' ELSE 'موجودٌ سلفاً — لا يُعاد إنشاؤه' END;
END $$;

CREATE TABLE IF NOT EXISTS credit_note_allocations (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  credit_note_id   uuid           NOT NULL,
  invoice_id       uuid           NOT NULL,
  amount           numeric(15,2)  NOT NULL,
  currency         varchar(10)    NOT NULL,
  allocation_date  date           NOT NULL,
  reference        varchar(200)   NOT NULL DEFAULT '',
  notes            text           NOT NULL DEFAULT '',
  batch_ref        uuid,
  created_by       varchar(120)   NOT NULL DEFAULT '',
  created_at       timestamptz    NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'credit_note_allocations_amount_chk') THEN
    ALTER TABLE credit_note_allocations ADD CONSTRAINT credit_note_allocations_amount_chk CHECK (amount > 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'credit_note_allocations_distinct_chk') THEN
    ALTER TABLE credit_note_allocations ADD CONSTRAINT credit_note_allocations_distinct_chk CHECK (credit_note_id <> invoice_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'credit_note_allocations_credit_note_fk') THEN
    ALTER TABLE credit_note_allocations ADD CONSTRAINT credit_note_allocations_credit_note_fk
      FOREIGN KEY (credit_note_id) REFERENCES invoices(id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'credit_note_allocations_invoice_fk') THEN
    ALTER TABLE credit_note_allocations ADD CONSTRAINT credit_note_allocations_invoice_fk
      FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE RESTRICT;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "IDX_credit_note_allocations_credit_note_id" ON credit_note_allocations (credit_note_id);
CREATE INDEX IF NOT EXISTS "IDX_credit_note_allocations_invoice_id" ON credit_note_allocations (invoice_id);

DO $$
DECLARE r text;
BEGIN
  ALTER TABLE credit_note_allocations ENABLE ROW LEVEL SECURITY;
  REVOKE ALL ON credit_note_allocations FROM PUBLIC;
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON credit_note_allocations FROM %I', r);
    END IF;
  END LOOP;
END $$;

DO $$
BEGIN
  IF to_regclass('public.credit_note_allocations') IS NULL THEN
    RAISE EXCEPTION 'VERIFY FAILED: credit_note_allocations لم يُنشأ';
  END IF;
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.credit_note_allocations'::regclass) THEN
    RAISE EXCEPTION 'VERIFY FAILED: RLS غير مفعّل على credit_note_allocations';
  END IF;
  RAISE NOTICE 'بعد الهجرة: credit_note_allocations موجود · صفوفه %', (SELECT count(*) FROM credit_note_allocations);
END $$;

COMMIT;
