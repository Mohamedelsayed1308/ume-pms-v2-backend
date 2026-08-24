-- ============================================================================
--  تراجع: المصادقة والرصيد التراكميّ
--  يعكس profit-ratification-up.sql
--
--  ⚠ تحذير
--  --------
--  الحذف **يُفقد بيانات**: لقطات المصادقة كلّها ودفتر الفروق كلّه. والفترات
--  التي أُغلقت تعود مفتوحةً بلا أثرٍ يقول إنّها صُودق عليها يوماً.
--
--  فلا يُشغَّل إلا لإرجاع الكود إلى ما قبل الهجرة، وبعد أخذ نسخة.
--
--  ولتخطّي البوّابة عمداً، أضف داخل المعاملة قبلها:
--
--      SET LOCAL ume.force_drop = 'on';
--
--  التشغيل:  محرّر SQL في Supabase — يُلصق كما هو
-- ============================================================================

BEGIN;

-- ── بوابة ١: لا تُحذف مصادقاتٌ ولا قيودٌ صامتةً ──────────────────────────
DO $$
DECLARE
  ratified int := 0;
  settlements int := 0;
  forced boolean := COALESCE(current_setting('ume.force_drop', true), 'off') = 'on';
BEGIN
  SELECT count(*) INTO ratified FROM profit_periods WHERE ratified_at IS NOT NULL;
  BEGIN
    SELECT count(*) INTO settlements FROM profit_settlements;
  EXCEPTION WHEN undefined_table THEN settlements := 0;
  END;

  IF (ratified > 0 OR settlements > 0) AND NOT forced THEN
    RAISE EXCEPTION
      'GATE 1 FAILED: % فترةً مُصادَقة و% قيداً في دفتر الفروق — الحذف يُفقدها. أضف SET LOCAL ume.force_drop = ''on'' إن كان مقصوداً',
      ratified, settlements;
  END IF;
  IF ratified > 0 OR settlements > 0 THEN
    RAISE NOTICE '⚠ تخطٍّ صريح: تُحذف % مصادقة و% قيداً', ratified, settlements;
  END IF;
END $$;

-- ── بصمةٌ قبليّة ─────────────────────────────────────────────────────────
DO $$
DECLARE rows_before int; cols_before int;
BEGIN
  SELECT count(*) INTO cols_before FROM information_schema.columns
  WHERE table_name = 'profit_periods';
  SELECT count(*) INTO rows_before FROM profit_periods;
  RAISE NOTICE 'قبل التراجع: % صفّاً · % عموداً', rows_before, cols_before;
END $$;

-- ── الحذف ────────────────────────────────────────────────────────────────
DROP TABLE IF EXISTS profit_settlements;

ALTER TABLE profit_periods
  DROP COLUMN IF EXISTS poseidon_fuel_supply,
  DROP COLUMN IF EXISTS amal_fuel_supply,
  DROP COLUMN IF EXISTS daleela_fuel_supply,
  DROP COLUMN IF EXISTS ratified_at,
  DROP COLUMN IF EXISTS ratified_by,
  DROP COLUMN IF EXISTS ratified_snapshot,
  DROP COLUMN IF EXISTS latest_snapshot,
  DROP COLUMN IF EXISTS latest_fetched_at;

-- ── بوابة ٢: كلّ ما وُعد بحذفه اختفى، والصفوف لم تُمسّ ──────────────────
DO $$
DECLARE n int; t int; rows_after int; cols_after int;
BEGIN
  SELECT count(*) INTO n FROM information_schema.columns
  WHERE table_name = 'profit_periods'
    AND column_name IN ('poseidon_fuel_supply', 'amal_fuel_supply', 'daleela_fuel_supply',
                        'ratified_at', 'ratified_by', 'ratified_snapshot',
                        'latest_snapshot', 'latest_fetched_at');
  IF n <> 0 THEN
    RAISE EXCEPTION 'GATE 2 FAILED: بقي % عموداً', n;
  END IF;
  SELECT count(*) INTO t FROM information_schema.tables
  WHERE table_name = 'profit_settlements';
  IF t <> 0 THEN
    RAISE EXCEPTION 'GATE 2 FAILED: جدول الفروق لم يُحذف';
  END IF;

  SELECT count(*) INTO cols_after FROM information_schema.columns
  WHERE table_name = 'profit_periods';
  SELECT count(*) INTO rows_after FROM profit_periods;
  RAISE NOTICE 'بعد التراجع: % صفّاً · % عموداً (المتوقّع −٨)', rows_after, cols_after;
END $$;

COMMIT;
