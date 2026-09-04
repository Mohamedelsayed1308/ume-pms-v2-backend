-- ============================================================================
--  تراجع: نتائج الصندوق الربعيّة — عكس docs/stone-fund-reports-up.sql
--
--  ⚠ يُتلف بيانات: صفوف التقارير الربعيّة المُدخَلة يدويّاً من تقارير CTM.
--  والبوّابة ترفض الحذف إن وُجد صفٌّ واحد، ولا تُتخطّى إلا بقرارٍ صريح:
--
--      SET LOCAL stone.force_drop = 'yes';
--
--  التشغيل:  node scripts/run-migration.js docs/stone-fund-reports-down.sql
-- ============================================================================

BEGIN;

DO $$
DECLARE rows_n int; forced text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                 WHERE table_schema = 'public' AND table_name = 'stone_fund_reports') THEN
    RAISE NOTICE 'stone_fund_reports غير موجود — لا شيء يُحذف';
    RETURN;
  END IF;
  SELECT count(*) INTO rows_n FROM stone_fund_reports;
  forced := current_setting('stone.force_drop', true);
  IF rows_n > 0 AND coalesce(forced, '') <> 'yes' THEN
    RAISE EXCEPTION 'GATE FAILED: stone_fund_reports فيه % صفّاً — لا يُحذف بلا SET LOCAL stone.force_drop = ''yes''', rows_n;
  END IF;
  RAISE NOTICE 'يُحذف stone_fund_reports (% صفّاً)', rows_n;
END $$;

DROP TABLE IF EXISTS stone_fund_reports;

COMMIT;
