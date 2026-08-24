-- ============================================================================
--  تراجع: عمولة البروكر
--  يعكس broker-commission-up.sql
--
--  ⚠ تحذير
--  --------
--  الحذف **يُفقد كلّ الاستحقاقات والسدادات**. وما سُدِّد للبروكر يذهب أثرُه،
--  فلا يبقى ما يُثبت أنّه سُدِّد.
--
--  فلا يُشغَّل إلا لإرجاع الكود إلى ما قبل الهجرة، وبعد أخذ نسخة.
--
--  ولتخطّي البوّابة عمداً، أضف داخل المعاملة قبلها:
--      SET LOCAL ume.force_drop = 'on';
-- ============================================================================

BEGIN;

DO $$
DECLARE
  led int := 0;
  forced boolean := COALESCE(current_setting('ume.force_drop', true), 'off') = 'on';
BEGIN
  BEGIN
    SELECT count(*) INTO led FROM broker_ledger;
  EXCEPTION WHEN undefined_table THEN led := 0;
  END;
  IF led > 0 AND NOT forced THEN
    RAISE EXCEPTION
      'GATE 1 FAILED: % قيداً في دفتر البروكر — الحذف يُفقدها. أضف SET LOCAL ume.force_drop = ''on'' إن كان مقصوداً',
      led;
  END IF;
  IF led > 0 THEN
    RAISE NOTICE '⚠ تخطٍّ صريح: يُحذف % قيداً', led;
  END IF;
END $$;

DROP TABLE IF EXISTS broker_ledger;
DROP TABLE IF EXISTS broker_rules;
DROP TABLE IF EXISTS brokers;

DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM information_schema.tables
  WHERE table_name IN ('brokers', 'broker_rules', 'broker_ledger');
  IF n <> 0 THEN
    RAISE EXCEPTION 'GATE 2 FAILED: بقي % جدولاً', n;
  END IF;
  RAISE NOTICE 'تمّ التراجع: الجداول الثلاثة حُذفت';
END $$;

COMMIT;
