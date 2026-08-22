-- ============================================================================
--  هجرة: تفصيل رحلات فترة التوزيع
--  الجدول: profit_periods   ·   عمودٌ واحد: voyage_detail jsonb
--
--  لماذا
--  ------
--  الفترة تخزّن مجاميع المراكب ولا تخزّن الرحلات التي كوّنتها. وشاشة التوزيع
--  تحتاج عرض ربح كلّ رحلة على حدة.
--
--  ولماذا يُخزَّن ولا يُجلَب عند العرض: **الدفتر يتغيّر**. تحصيل صفاجا لأمل في
--  فترة ١٨–٣١ يوليو ٢٠٢٦ صُحِّح بعد إصدار المستند بـ ١٢٬٨٩٨.٩٠ — أكّده المالك.
--  فجلبُ التفصيل لاحقاً يعرض أرقاماً لا تجمع إلى التوزيع المحفوظ، وذلك أسوأ من
--  ألّا يُعرض شيء. والمخزَّن لقطةٌ تُثبت ما حُسب منه.
--
--  الأمان
--  ------
--  إضافةٌ محضة: عمودٌ واحد قابل للفراغ، لا يُحذف عمود ولا يتغيّر نوع ولا يُكتب
--  صفّ. الصفوف القائمة تبقى بـ NULL، وتُملأ عند أوّل جلبٍ للفترة.
--
--  متكرّرة الأمان: IF NOT EXISTS — فإعادة التشغيل بلا أثر.
--
--  التشغيل:  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f profit-voyage-detail-up.sql
--  التراجع:  profit-voyage-detail-down.sql
-- ============================================================================

\set ON_ERROR_STOP on

BEGIN;

-- ── بوابة ١: الجدول موجود وفيه أعمدة المعادلة ────────────────────────────
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM information_schema.columns
  WHERE table_name = 'profit_periods'
    AND column_name IN ('poseidon_cash_duba', 'amal_cash_duba', 'adjust_reason');
  IF n <> 3 THEN
    RAISE EXCEPTION 'GATE 1 FAILED: أعمدة معادلة التوزيع غير مكتملة (وُجد %)', n;
  END IF;
END $$;

-- ── بوابة ٢: بصمةٌ قبليّة تُطبع لتُقارن بعد ──────────────────────────────
DO $$
DECLARE rows_before int; sum_before numeric;
BEGIN
  SELECT count(*), COALESCE(sum(poseidon_cash_duba + amal_cash_duba + daleela_cash_duba), 0)
    INTO rows_before, sum_before FROM profit_periods;
  RAISE NOTICE 'قبل الهجرة: % صفّاً · مجموع نقد ضبا %', rows_before, sum_before;
END $$;

-- ── العمود ───────────────────────────────────────────────────────────────
ALTER TABLE profit_periods
  ADD COLUMN IF NOT EXISTS voyage_detail jsonb;

-- ── بوابة ٣: العمود أُنشئ بالنوع الصحيح ─────────────────────────────────
DO $$
DECLARE t text;
BEGIN
  SELECT data_type INTO t FROM information_schema.columns
  WHERE table_name = 'profit_periods' AND column_name = 'voyage_detail';
  IF t IS NULL THEN
    RAISE EXCEPTION 'GATE 3 FAILED: العمود لم يُنشأ';
  END IF;
  IF t <> 'jsonb' THEN
    RAISE EXCEPTION 'GATE 3 FAILED: النوع % لا jsonb', t;
  END IF;
END $$;

-- ── بوابة ٤: بصمةٌ بعديّة — يجب أن تُطابق القبليّة ──────────────────────
DO $$
DECLARE rows_after int; sum_after numeric; nulls int;
BEGIN
  SELECT count(*), COALESCE(sum(poseidon_cash_duba + amal_cash_duba + daleela_cash_duba), 0),
         count(*) FILTER (WHERE voyage_detail IS NULL)
    INTO rows_after, sum_after, nulls FROM profit_periods;
  RAISE NOTICE 'بعد الهجرة: % صفّاً · مجموع نقد ضبا % · % صفّاً بلا تفصيل (متوقّع)',
    rows_after, sum_after, nulls;
END $$;

COMMIT;
