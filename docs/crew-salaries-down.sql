-- ============================================================================
--  تراجع: مرتّبات أطقم السفن — عكس docs/crew-salaries-up.sql
--
--  ⚠ يُتلف بيانات: الملفّات الأصليّة والقرارات والحسابات والتفويضات وإصدارات الاعتماد
--  وسجلّ التدقيق. والبوّابة ترفض الحذف إن وُجد صفٌّ واحدٌ في أيّ جدول، ولا تُتخطّى إلا
--  بقرارٍ صريح:
--
--      SET LOCAL crew_salary.force_drop = 'yes';
--
--  التشغيل:  node scripts/run-migration.js docs/crew-salaries-down.sql
-- ============================================================================

BEGIN;

DO $$
DECLARE t text; n bigint; total bigint := 0; forced text;
BEGIN
  FOREACH t IN ARRAY ARRAY['crew_salary_cycles','crew_salary_files','crew_salary_decisions','crew_salary_links',
    'crew_salary_authorizations','crew_salary_bank_accounts','crew_salary_versions','crew_salary_entitlements',
    'crew_salary_exports','crew_salary_audit'] LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('SELECT count(*) FROM %I', t) INTO n;
      total := total + n;
    END IF;
  END LOOP;
  forced := current_setting('crew_salary.force_drop', true);
  IF total > 0 AND coalesce(forced, '') <> 'yes' THEN
    RAISE EXCEPTION 'GATE FAILED: في جداول المرتّبات % صفّاً — لا تُحذف بلا SET LOCAL crew_salary.force_drop = ''yes''', total;
  END IF;
  RAISE NOTICE 'تُحذف جداول المرتّبات (% صفّاً)', total;
END $$;

DROP TABLE IF EXISTS crew_salary_audit;
DROP TABLE IF EXISTS crew_salary_exports;
DROP TABLE IF EXISTS crew_salary_entitlements;
DROP TABLE IF EXISTS crew_salary_versions;
DROP TABLE IF EXISTS crew_salary_bank_accounts;
DROP TABLE IF EXISTS crew_salary_authorizations;
DROP TABLE IF EXISTS crew_salary_links;
DROP TABLE IF EXISTS crew_salary_decisions;
DROP TABLE IF EXISTS crew_salary_files;
DROP TABLE IF EXISTS crew_salary_cycles;
DROP FUNCTION IF EXISTS crew_salary_audit_append_only();
DROP FUNCTION IF EXISTS crew_salary_version_frozen();

COMMIT;
