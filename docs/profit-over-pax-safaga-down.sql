-- ============================================================================
--  تراجع: Over Pax المحصَّل في صفاجا
--  يعكس profit-over-pax-safaga-up.sql
--
--  ⚠ تحذير
--  --------
--  الحذف **يُفقد بيانات**. كلّ ما أُدخل في هذه الأعمدة يذهب، والفترات التي
--  فُصل فيها Over Pax تعود إلى جزء ضبا وحده — فيبدو التوزيع ناقصاً ولا يُعلَن
--  ذلك. فلا يُشغَّل إلا لإرجاع الكود إلى ما قبل الهجرة، وبعد أخذ نسخة.
--
--  والبوّابة الأولى تمنع الحذف إن وُجد صفٌّ بقيمةٍ غير صفريّة. ولتخطّيها عمداً،
--  أضف هذا السطر **داخل المعاملة قبل البوّابة**:
--
--      SET LOCAL ume.force_drop = 'on';
--
--  التشغيل:  محرّر SQL في Supabase — يُلصق كما هو
--            أو  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f profit-over-pax-safaga-down.sql
--
--  ولا أوامرَ psql خاصّة فيه، فيعمل في المحرّرين معاً بلا تعديل.
-- ============================================================================

BEGIN;

-- ── بوابة ١: لا تُحذف بياناتٌ حقيقيّة صامتةً ─────────────────────────────
DO $$
DECLARE
  used int;
  forced boolean := COALESCE(current_setting('ume.force_drop', true), 'off') = 'on';
BEGIN
  SELECT count(*) INTO used FROM profit_periods
  WHERE poseidon_over_pax_safaga <> 0 OR amal_over_pax_safaga <> 0
     OR daleela_over_pax_safaga <> 0;
  IF used > 0 AND NOT forced THEN
    RAISE EXCEPTION
      'GATE 1 FAILED: % صفّاً يحمل Over Pax صفاجا — الحذف يُفقده. أضف SET LOCAL ume.force_drop = ''on'' إن كان مقصوداً',
      used;
  END IF;
  IF used > 0 THEN
    RAISE NOTICE '⚠ تخطٍّ صريح: يُحذف Over Pax صفاجا من % صفّاً', used;
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
ALTER TABLE profit_periods
  DROP COLUMN IF EXISTS poseidon_over_pax_safaga,
  DROP COLUMN IF EXISTS amal_over_pax_safaga,
  DROP COLUMN IF EXISTS daleela_over_pax_safaga;

-- ── بوابة ٢: الأعمدة اختفت والصفوف لم تُمسّ ─────────────────────────────
DO $$
DECLARE n int; rows_after int; cols_after int;
BEGIN
  SELECT count(*) INTO n FROM information_schema.columns
  WHERE table_name = 'profit_periods'
    AND column_name IN ('poseidon_over_pax_safaga', 'amal_over_pax_safaga',
                        'daleela_over_pax_safaga');
  IF n <> 0 THEN
    RAISE EXCEPTION 'GATE 2 FAILED: بقي % عموداً', n;
  END IF;
  SELECT count(*) INTO cols_after FROM information_schema.columns
  WHERE table_name = 'profit_periods';
  SELECT count(*) INTO rows_after FROM profit_periods;
  RAISE NOTICE 'بعد التراجع: % صفّاً · % عموداً (المتوقّع −٣)', rows_after, cols_after;
END $$;

COMMIT;
