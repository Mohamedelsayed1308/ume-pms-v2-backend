-- ============================================================================
--  تراجع: مصاريف المركب من دفتر الشركة — عكس docs/vessel-cogs-up.sql
--
--  ⚠ يُتلف بيانات: القيود المستورَدة من QuickBooks وسطور وثائق التأمين
--  والإهلاك المُدخَلة يدويّاً. والبوّابة ترفض الحذف إن وُجد صفٌّ واحد، ولا
--  تُتخطّى إلا بقرارٍ صريح:
--
--      SET LOCAL cogs.force_drop = 'yes';
--
--  التشغيل:  node scripts/run-migration.js docs/vessel-cogs-down.sql
-- ============================================================================

BEGIN;

DO $$
DECLARE rows_n int; forced text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                 WHERE table_schema = 'public' AND table_name = 'vessel_cogs_entries') THEN
    RAISE NOTICE 'vessel_cogs_entries غير موجود — لا شيء يُحذف';
    RETURN;
  END IF;
  SELECT count(*) INTO rows_n FROM vessel_cogs_entries;
  forced := current_setting('cogs.force_drop', true);
  IF rows_n > 0 AND coalesce(forced, '') <> 'yes' THEN
    RAISE EXCEPTION 'GATE FAILED: vessel_cogs_entries فيه % صفّاً — لا يُحذف بلا SET LOCAL cogs.force_drop = ''yes''', rows_n;
  END IF;
  RAISE NOTICE 'يُحذف vessel_cogs_entries (% صفّاً)', rows_n;
END $$;

DROP TABLE IF EXISTS vessel_cogs_entries;

COMMIT;
