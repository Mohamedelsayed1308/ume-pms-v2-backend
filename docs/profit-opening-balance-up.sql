-- ============================================================================
--  هجرة: رصيدٌ افتتاحيّ في دفتر الفروق
--  الجدول: profit_settlements  ·  `period_id` يصير قابلاً للفراغ
--
--  لماذا
--  ------
--  الدفتر بُني على أنّ كلّ قيدٍ يخصّ فترة: فرقٌ رُصد عليها، أو تسويةٌ أُدخلت
--  فيها. والرصيد **الافتتاحيّ** لا فترةَ له — هو ما تراكم قبل أن يوجد النظام.
--
--  والمالك أعطى الافتتاحيّ قبل أوّل مصادقة:
--      بدوي    ٩٠٬٣٦٣.٣٠−
--      الاتحاد ٣٤٬٩٥٠.٤٤−
--
--  فإمّا أن يُعلَّق على فترةٍ لا يخصّها — فيُحذف معها إن حُذفت، ويُقرأ خطأً على
--  أنّه فرقُها — أو يُترك بلا فترة. والثاني هو الصادق.
--
--  الأمان
--  ------
--  `DROP NOT NULL` توسيعٌ لا تضييق: كلّ صفٍّ قائمٍ يبقى صالحاً، ولا يتغيّر نوع
--  ولا يُحذف عمود. والقيود القائمة كلّها لها فترة، فلا شيء يتأثّر.
--
--  ولا عكسَ آمناً لها: إعادة `NOT NULL` تفشل إن وُجد رصيدٌ افتتاحيّ. ولهذا
--  يمنعها ملفّ التراجع إلا بتخطٍّ صريح.
--
--  التشغيل:  محرّر SQL في Supabase — يُلصق كما هو
--  التراجع:  profit-opening-balance-down.sql
-- ============================================================================

BEGIN;

-- ── بوابة ١: الجدول موجودٌ بالشكل المتوقَّع ──────────────────────────────
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM information_schema.columns
  WHERE table_name = 'profit_settlements'
    AND column_name IN ('period_id', 'partner', 'amount', 'kind');
  IF n <> 4 THEN
    RAISE EXCEPTION 'GATE 1 FAILED: جدول الفروق غير مكتمل (وُجد %) — هل نُفّذت هجرة المصادقة؟', n;
  END IF;
END $$;

-- ── بصمةٌ قبليّة ─────────────────────────────────────────────────────────
DO $$
DECLARE rows_before int; nullable text;
BEGIN
  SELECT count(*) INTO rows_before FROM profit_settlements;
  SELECT is_nullable INTO nullable FROM information_schema.columns
  WHERE table_name = 'profit_settlements' AND column_name = 'period_id';
  RAISE NOTICE 'قبل الهجرة: % قيداً · period_id nullable = %', rows_before, nullable;
END $$;

-- ── التوسيع ──────────────────────────────────────────────────────────────
ALTER TABLE profit_settlements
  ALTER COLUMN period_id DROP NOT NULL;

-- ── بوابة ٢: صار قابلاً للفراغ، والقيود القائمة لم تُمسّ ────────────────
DO $$
DECLARE nullable text; rows_after int; orphans int;
BEGIN
  SELECT is_nullable INTO nullable FROM information_schema.columns
  WHERE table_name = 'profit_settlements' AND column_name = 'period_id';
  IF nullable <> 'YES' THEN
    RAISE EXCEPTION 'GATE 2 FAILED: period_id ما زال إلزاميّاً';
  END IF;

  SELECT count(*) INTO rows_after FROM profit_settlements;
  SELECT count(*) INTO orphans FROM profit_settlements WHERE period_id IS NULL;
  RAISE NOTICE 'بعد الهجرة: % قيداً · % بلا فترة (المتوقّع ٠ الآن)', rows_after, orphans;
  IF orphans <> 0 THEN
    RAISE EXCEPTION 'GATE 2 FAILED: ظهر % قيداً بلا فترة — الهجرة لا تكتب صفوفاً', orphans;
  END IF;
END $$;

COMMIT;

-- ============================================================================
--  الرصيد الافتتاحيّ **لا يُكتب هنا**.
--  يُدخَل من شاشة «الرصيد التراكميّ» ليُرى بالكلمات قبل أن يُحفظ — فالإشارة
--  تُحدّد ربع مليون، ورقمٌ يُكتب في محرّر SQL لا يُراجعه أحد.
-- ============================================================================
