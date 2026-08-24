-- ============================================================================
--  هجرة: Over Pax المحصَّل في صفاجا
--  الجدول: profit_periods   ·   ثلاثة أعمدة: {vessel}_over_pax_safaga
--
--  لماذا
--  ------
--  Over Pax قد يُحصَّل في مكانين. والداخل في وعاء ضبا هو **جزء ضبا وحده**؛ وما
--  حُصّل في صفاجا يبقى عند حائزه، ونصيب الشريك الآخر يُحوَّل إليه ضمن تسوية
--  صفاجا. والنظام كان يعرف حقلاً واحداً، فمن يُدخل يخلط الجزأين.
--
--  ومستند «Summary From 01 till 15 Aug 2026» يُظهر الطرفين صراحةً:
--
--      Voy.#75 · إجمالي ٥٬٩٣٦.٩٣  =  Saf ٤٬٩٥٥.٦٠  +  Dub ٩٨١.٣٣
--
--      نقد بوسيدون في صفاجا = ٢٢٠٬٨٠٩.٣٥ − ٣٤٬٨٢٦.٣٨ + ٤٬٩٥٥.٦٠ = ١٩٠٬٩٣٨.٥٧
--      نقد أمل في صفاجا     = ١٥٤٬٤٦٠.٠٠ + ٣٤٬٨٢٦.٣٨            = ١٨٩٬٢٨٦.٣٨
--
--  وأُدخل المبلغ كاملاً في فترة ١–١٥ أغسطس، فبولغ في نصيب بوسيدون ٤٬٩٥٥ دولاراً.
--  والحقلان معاً هما الحارس: من يُدخل لا يستطيع أن يخلط بعد اليوم.
--
--  الأمان
--  ------
--  إضافةٌ محضة: ثلاثة أعمدة رقميّة افتراضها صفر، لا يُحذف عمود ولا يتغيّر نوع
--  ولا يُكتب صفّ. الصفوف القائمة تبقى بصفر — وهو الصحيح: لم يُسجَّل فيها
--  Over Pax صفاجا قطّ، وما أُدخل خطأً يُصحَّح يدوياً بعد الهجرة.
--
--  والنوع `decimal(15,4)` كسائر أعمدة المال في الجدول.
--
--  متكرّرة الأمان: IF NOT EXISTS — فإعادة التشغيل بلا أثر.
--
--  التشغيل:  محرّر SQL في Supabase — يُلصق كما هو
--            أو  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f profit-over-pax-safaga-up.sql
--  التراجع:  profit-over-pax-safaga-down.sql
--
--  ولا أوامرَ psql خاصّة فيه (لا \set ولا \if): البوّابات تُوقف المعاملة
--  بـ RAISE EXCEPTION، فيعمل الملفّ في المحرّرين معاً بلا تعديل.
-- ============================================================================

BEGIN;

-- ── بوابة ١: الجدول موجود وفيه أعمدة Over Pax الأصليّة ───────────────────
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM information_schema.columns
  WHERE table_name = 'profit_periods'
    AND column_name IN ('poseidon_over_pax', 'amal_over_pax', 'daleela_over_pax');
  IF n <> 3 THEN
    RAISE EXCEPTION 'GATE 1 FAILED: أعمدة Over Pax الأصليّة غير مكتملة (وُجد %)', n;
  END IF;
END $$;

-- ── بوابة ٢: بصمةٌ قبليّة تُطبع لتُقارن بعد ──────────────────────────────
DO $$
DECLARE rows_before int; cols_before int; op_before numeric;
BEGIN
  SELECT count(*) INTO cols_before FROM information_schema.columns
  WHERE table_name = 'profit_periods';
  SELECT count(*), COALESCE(sum(poseidon_over_pax + amal_over_pax + daleela_over_pax), 0)
    INTO rows_before, op_before FROM profit_periods;
  RAISE NOTICE 'قبل الهجرة: % صفّاً · % عموداً · مجموع Over Pax %',
    rows_before, cols_before, op_before;
END $$;

-- ── الأعمدة ──────────────────────────────────────────────────────────────
ALTER TABLE profit_periods
  ADD COLUMN IF NOT EXISTS poseidon_over_pax_safaga decimal(15,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS amal_over_pax_safaga     decimal(15,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS daleela_over_pax_safaga  decimal(15,4) NOT NULL DEFAULT 0;

-- ── بوابة ٣: الأعمدة أُنشئت بالنوع الصحيح وبصفر ─────────────────────────
DO $$
DECLARE n int; bad int;
BEGIN
  SELECT count(*) INTO n FROM information_schema.columns
  WHERE table_name = 'profit_periods'
    AND column_name IN ('poseidon_over_pax_safaga', 'amal_over_pax_safaga',
                        'daleela_over_pax_safaga')
    AND data_type = 'numeric' AND numeric_precision = 15 AND numeric_scale = 4;
  IF n <> 3 THEN
    RAISE EXCEPTION 'GATE 3 FAILED: الأعمدة الثلاثة لم تُنشأ بالنوع الصحيح (وُجد %)', n;
  END IF;

  SELECT count(*) INTO bad FROM profit_periods
  WHERE poseidon_over_pax_safaga <> 0 OR amal_over_pax_safaga <> 0
     OR daleela_over_pax_safaga <> 0;
  IF bad <> 0 THEN
    RAISE EXCEPTION 'GATE 3 FAILED: % صفّاً بقيمةٍ غير صفريّة — الافتراض لم يُطبَّق', bad;
  END IF;
END $$;

-- ── بوابة ٤: بصمةٌ بعديّة — الصفوف وOver Pax الأصليّ لم يتغيّرا ─────────
DO $$
DECLARE rows_after int; cols_after int; op_after numeric;
BEGIN
  SELECT count(*) INTO cols_after FROM information_schema.columns
  WHERE table_name = 'profit_periods';
  SELECT count(*), COALESCE(sum(poseidon_over_pax + amal_over_pax + daleela_over_pax), 0)
    INTO rows_after, op_after FROM profit_periods;
  RAISE NOTICE 'بعد الهجرة: % صفّاً · % عموداً · مجموع Over Pax %',
    rows_after, cols_after, op_after;
  RAISE NOTICE 'المتوقّع: الصفوف ومجموع Over Pax كما هما · الأعمدة +٣';
END $$;

COMMIT;

-- ============================================================================
--  بعد الهجرة — تصحيحٌ يدويّ لفترة ١–١٥ أغسطس ٢٠٢٦
--  ---------------------------------------------------------------------------
--  أُدخل ٥٬٩٣٦.٩٣ كاملاً في `poseidon_over_pax`، والصواب فصلُه:
--
--      UPDATE profit_periods
--         SET poseidon_over_pax        =   981.33,
--             poseidon_over_pax_safaga = 4955.60
--       WHERE date_from = '2026-08-01' AND date_to = '2026-08-15';
--
--  ولا يُنفَّذ هنا: التصحيح قرارُ مالكٍ لا خطوةَ هجرة، ويُجرى من الشاشة بعد
--  نشر الحقل الجديد ليُرى أثرُه قبل الحفظ.
-- ============================================================================
