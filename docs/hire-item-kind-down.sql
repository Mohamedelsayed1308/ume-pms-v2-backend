-- ============================================================================
--  تراجع: نوعُ بند فاتورة الإيجار
--  يعكس hire-item-kind-up.sql
--
--  ⚠ الحذف يُفقد التصنيف اليدويّ.
--  ما استنتجته الهجرة يُعاد استنتاجه، وما صحّحه المالك بيده لا يُعاد.
--  ويعود أساسُ العمولة إلى إجمالي الفاتورة — وهو الخطأ الذي صُحّح.
-- ============================================================================

BEGIN;

DO $$
DECLARE manual int;
BEGIN
  -- بنودٌ نوعُها لا يوافق ما يُستنتج من وصفها = تصنيفٌ يدويّ
  SELECT count(*) INTO manual FROM hire_invoice_items
  WHERE item_kind <> CASE
    WHEN description ~* '(off[[:space:]_-]*hire)' THEN 'off_hire'
    WHEN description ~* 'hire'                    THEN 'hire'
    ELSE 'other'
  END;
  IF manual > 0 THEN
    RAISE NOTICE '⚠ % بنداً صُنّف يدويّاً بخلاف وصفه — يذهب تصنيفه', manual;
  END IF;
END $$;

ALTER TABLE hire_invoice_items DROP COLUMN IF EXISTS item_kind;

DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM information_schema.columns
  WHERE table_name = 'hire_invoice_items' AND column_name = 'item_kind';
  IF n <> 0 THEN
    RAISE EXCEPTION 'GATE FAILED: العمود لم يُحذف';
  END IF;
  RAISE NOTICE 'تمّ التراجع: item_kind حُذف';
END $$;

COMMIT;
