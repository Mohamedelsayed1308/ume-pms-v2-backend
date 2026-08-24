-- ============================================================================
--  تراجع: رصيدٌ افتتاحيّ في دفتر الفروق
--  يعكس profit-opening-balance-up.sql
--
--  ⚠ تحذير
--  --------
--  إعادة `NOT NULL` **تفشل** إن وُجد رصيدٌ افتتاحيّ — وهو الصحيح: القيد بلا
--  فترة لا مكان له في العمود الإلزاميّ، وإجباره يعني حذفه أو تعليقه على فترةٍ
--  لا يخصّها.
--
--  فإن كان الحذف مقصوداً حقّاً، احذف القيود الافتتاحيّة أوّلاً بيدك — بعد
--  تسجيل أرقامها في مكانٍ آخر.
--
--  التشغيل:  محرّر SQL في Supabase — يُلصق كما هو
-- ============================================================================

BEGIN;

-- ── بوابة ١: لا يُحذف رصيدٌ افتتاحيٌّ صامتاً ─────────────────────────────
DO $$
DECLARE opening int;
BEGIN
  SELECT count(*) INTO opening FROM profit_settlements WHERE period_id IS NULL;
  IF opening > 0 THEN
    RAISE EXCEPTION
      'GATE 1 FAILED: % قيداً افتتاحيّاً بلا فترة — احذفها بيدك أوّلاً بعد تسجيل أرقامها',
      opening;
  END IF;
END $$;

ALTER TABLE profit_settlements
  ALTER COLUMN period_id SET NOT NULL;

-- ── بوابة ٢ ──────────────────────────────────────────────────────────────
DO $$
DECLARE nullable text;
BEGIN
  SELECT is_nullable INTO nullable FROM information_schema.columns
  WHERE table_name = 'profit_settlements' AND column_name = 'period_id';
  IF nullable <> 'NO' THEN
    RAISE EXCEPTION 'GATE 2 FAILED: period_id ما زال قابلاً للفراغ';
  END IF;
  RAISE NOTICE 'تمّ التراجع: period_id صار إلزاميّاً';
END $$;

COMMIT;
