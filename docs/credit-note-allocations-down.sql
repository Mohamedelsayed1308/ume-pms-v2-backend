-- ============================================================================
--  تراجع: تطبيق الإشعارات الدائنة — يحذف credit_note_allocations
--
--  الجدول فارغٌ = حذفٌ آمن. وإن كان فيه تطبيقاتٌ مسجّلة فحذفه يعيد الفواتير التي
--  أُغلقت بها «جزئيّة» والإشعارات «غير مستخدَمة» عند أوّل إعادة حساب — فلا يُحذف
--  إلّا بإقرارٍ صريح:
--    SET LOCAL credit_alloc.force_drop = 'yes';
--
--  ترتيب التراجع: إرجاع الواجهة ثمّ الباك أوّلاً (الباك يقرأ الجدول) ← ثمّ هذا الملفّ.
--
--  التشغيل:  node scripts/run-migration.js docs/credit-note-allocations-down.sql
-- ============================================================================

BEGIN;

DO $$
DECLARE rows_n int; forced text;
BEGIN
  IF to_regclass('public.credit_note_allocations') IS NULL THEN
    RAISE NOTICE 'credit_note_allocations غير موجود — لا شيء يُحذف';
    RETURN;
  END IF;
  SELECT count(*) INTO rows_n FROM credit_note_allocations;
  forced := current_setting('credit_alloc.force_drop', true);
  IF rows_n > 0 AND coalesce(forced, '') <> 'yes' THEN
    RAISE EXCEPTION 'GATE FAILED: credit_note_allocations فيه % صفّاً — لا يُحذف بلا SET LOCAL credit_alloc.force_drop = ''yes''', rows_n;
  END IF;
  RAISE NOTICE 'يُحذف credit_note_allocations (% صفّاً)', rows_n;
END $$;

DROP TABLE IF EXISTS credit_note_allocations;

COMMIT;
