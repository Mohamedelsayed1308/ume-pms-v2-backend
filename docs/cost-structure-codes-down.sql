-- ============================================================================
--  تراجع: رموز هيكل التكاليف — يحذف cost_item_codes
--
--  الجدول فارغٌ = حذفٌ آمن. وإن كان فيه ربطٌ حفظه الأدمن فالحذف يُرجع كلّ البنود
--  إلى تصنيفها الافتراضيّ في الكود، فلا يُحذف إلّا بإقرارٍ صريح:
--    SET LOCAL cost_codes.force_drop = 'yes';
--  والأسرع احتواءً من الحذف: إرجاع الواجهة، فالجدول لا يقرؤه غيرها.
--
--  التشغيل:  node scripts/run-migration.js docs/cost-structure-codes-down.sql
-- ============================================================================

BEGIN;

DO $$
DECLARE rows_n int; forced text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                 WHERE table_schema = 'public' AND table_name = 'cost_item_codes') THEN
    RAISE NOTICE 'cost_item_codes غير موجود — لا شيء يُحذف';
    RETURN;
  END IF;
  SELECT count(*) INTO rows_n FROM cost_item_codes;
  forced := current_setting('cost_codes.force_drop', true);
  IF rows_n > 0 AND coalesce(forced, '') <> 'yes' THEN
    RAISE EXCEPTION 'GATE FAILED: cost_item_codes فيه % صفّاً — لا يُحذف بلا SET LOCAL cost_codes.force_drop = ''yes''', rows_n;
  END IF;
  RAISE NOTICE 'يُحذف cost_item_codes (% صفّاً)', rows_n;
END $$;

DROP TABLE IF EXISTS cost_item_codes;

COMMIT;
