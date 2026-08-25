-- ============================================================================
--  هجرة: نوعُ بند فاتورة الإيجار
--  الجدول: hire_invoice_items  ·  عمودٌ واحد: item_kind
--
--  لماذا
--  ------
--  عمولة البروكر تُحسب على **إجمالي بنود الـ Hire** لا على إجمالي الفاتورة —
--  تصحيحُ المالك في ٢٥ أغسطس ٢٠٢٦.
--
--  وفاتورةُ الإيجار تحمل بنوداً ليست إيجاراً: تموينٌ وغسيلٌ (بالسالب)، وتعويضُ
--  إعفاءٍ من الإرشاد. فحسابُها على الإجمالي يُنقص الأساس حين تكون سالبة.
--
--      ZA-26-08-02:  إجمالي ٢٧٩٬٠٠٠  ·  Hire ٢٩٤٬٠٠٠  ·  غسيل (١٥٬٠٠٠)
--                    العمولة ٣٬٤٨٧.٥٠ والصواب ٣٬٦٧٥.٠٠
--
--  ── ولماذا نوعٌ لا علامةٌ منطقيّة ──
--  البند يقول **ما هو** لا «أيُحتسب أم لا». فالنوع يخدم العمولة اليوم، ويخدم
--  أيّ قاعدةٍ تأتي غداً بلا عمودٍ ثانٍ.
--
--  ── والفخّ الذي يمنعه ──
--  `Off Hire` مصطلحٌ قياسيّ في مشارطات الإيجار، ومعناه **خصم**. ومطابقةُ كلمة
--  «hire» في الوصف كانت ستُدخله في الأساس فتزيد العمولة — خطأً صامتاً في
--  الاتّجاه المعاكس. ولا وجود له في النظام اليوم، **لكنّه سيأتي**.
--
--  القيم
--  -----
--      hire      إيجارٌ · يدخل أساس العمولة
--      other     بندٌ آخر · لا يدخل
--      off_hire  إيقافٌ عن الإيجار · لا يدخل
--
--  الاستنتاج للبنود القائمة
--  ------------------------
--  من الوصف، وبترتيبٍ يمنع الفخّ: `off hire` أوّلاً، ثمّ `hire`، وما بقي `other`.
--  ويُراجَع بعدها في الشاشة — والنوع ظاهرٌ في كلّ سطر.
--
--  الأمان
--  ------
--  إضافةٌ محضة بافتراض `hire`، فلا صفَّ يفقد قيمةً ولا عمودَ يُحذف. والاستنتاج
--  لا يمسّ مبلغاً — يكتب نوعاً فقط.
--
--  التشغيل:  node scripts/run-migration.js docs/hire-item-kind-up.sql
--  التراجع:  hire-item-kind-down.sql
-- ============================================================================

BEGIN;

-- ── بوابة ١ ──────────────────────────────────────────────────────────────
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM information_schema.columns
  WHERE table_name = 'hire_invoice_items'
    AND column_name IN ('description', 'amount', 'hire_invoice_id');
  IF n <> 3 THEN
    RAISE EXCEPTION 'GATE 1 FAILED: جدول البنود غير مكتمل (وُجد %)', n;
  END IF;
END $$;

-- ── بصمةٌ قبليّة ─────────────────────────────────────────────────────────
DO $$
DECLARE n int; s numeric;
BEGIN
  SELECT count(*), COALESCE(SUM(amount), 0) INTO n, s FROM hire_invoice_items;
  RAISE NOTICE 'قبل الهجرة: % بنداً · مجموع %', n, s;
END $$;

-- ── العمود ───────────────────────────────────────────────────────────────
ALTER TABLE hire_invoice_items
  ADD COLUMN IF NOT EXISTS item_kind varchar(20) NOT NULL DEFAULT 'hire';

-- ── الاستنتاج — `off hire` أوّلاً حتّى لا تبتلعه «hire» ──────────────────
UPDATE hire_invoice_items
   SET item_kind = CASE
     WHEN description ~* '(off[[:space:]_-]*hire)' THEN 'off_hire'
     WHEN description ~* 'hire'                    THEN 'hire'
     ELSE 'other'
   END;

-- ── بوابة ٢: العمود أُنشئ، ولا مبلغَ تغيّر، ولا نوعَ خارج القائمة ───────
DO $$
DECLARE n int; s numeric; bad int; r record;
BEGIN
  SELECT count(*) INTO n FROM information_schema.columns
  WHERE table_name = 'hire_invoice_items' AND column_name = 'item_kind';
  IF n <> 1 THEN
    RAISE EXCEPTION 'GATE 2 FAILED: العمود لم يُنشأ';
  END IF;

  SELECT count(*) INTO bad FROM hire_invoice_items
  WHERE item_kind NOT IN ('hire', 'other', 'off_hire');
  IF bad <> 0 THEN
    RAISE EXCEPTION 'GATE 2 FAILED: % بنداً بنوعٍ خارج القائمة', bad;
  END IF;

  SELECT count(*), COALESCE(SUM(amount), 0) INTO n, s FROM hire_invoice_items;
  RAISE NOTICE 'بعد الهجرة: % بنداً · مجموع % (يجب أن يكون كما هو)', n, s;

  FOR r IN SELECT item_kind, count(*) c FROM hire_invoice_items GROUP BY item_kind ORDER BY item_kind
  LOOP
    RAISE NOTICE '   %: % بنداً', r.item_kind, r.c;
  END LOOP;
END $$;

COMMIT;

-- ============================================================================
--  وبعدها تُعاد مزامنة عمولة البروكر — من الشاشة أو بـ
--      POST api/brokers/sync/:invoiceId
--  فالأساس صار مجموع بنود `hire`، والقيود القائمة محسوبةٌ على الإجمالي.
-- ============================================================================
