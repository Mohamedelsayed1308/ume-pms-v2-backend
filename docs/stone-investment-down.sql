-- ============================================================================
--  تراجع: كارت متابعة استثمار Stone Shipping
--  عكس  docs/stone-investment-up.sql
--
--  ⚠ هذا يُتلف بيانات
--  ------------------
--  الجداول الثمانية تحمل دفتر القرض بين UME Holdings وBee، ودفتر الاستثمار في
--  Stone، وتأكيدات البنك. وحذفُها يمحوها كلَّها — ولا مصدرَ آخر لها في النظام.
--
--  ومصادرُها خارج النظام ناقصة: شيت Stone متأخّرٌ بقسط، ومستند JSON لقطةٌ ليوم
--  ٢٨ أغسطس. فما أُدخل بعدهما لا يُسترجَع من أيّ مكان.
--
--  فالبوّابة ترفض الحذف إن وُجد صفٌّ واحد، ولا تُتخطّى إلا بقرارٍ صريح:
--
--      SET LOCAL stone.force_drop = 'yes';
--
--  ولا يُكتب ذلك السطر إلا بعد نسخةٍ احتياطيّةٍ مُتحقَّقٍ منها.
--
--  التشغيل:  node scripts/run-migration.js docs/stone-investment-down.sql
-- ============================================================================

BEGIN;

-- ── بوابة: لا حذفَ فوق بيانات ────────────────────────────────────────────
DO $$
DECLARE rows_total int; forced text;
BEGIN
  -- الجداول قد لا تكون موجودةً أصلاً — فالتراجع عن تراجعٍ لا يفشل
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                 WHERE table_schema = 'public' AND table_name = 'stone_rounds') THEN
    RAISE NOTICE 'لا جداول Stone — لا شيء يُحذف';
    RETURN;
  END IF;

  SELECT (SELECT count(*) FROM stone_rounds)
       + (SELECT count(*) FROM stone_parent_ledger)
       + (SELECT count(*) FROM stone_investment_ledger)
       + (SELECT count(*) FROM stone_bank_confirmations)
       + (SELECT count(*) FROM stone_fund_calls)
       + (SELECT count(*) FROM stone_vessels)
       + (SELECT count(*) FROM stone_open_items)
       + (SELECT count(*) FROM stone_interest_terms)
    INTO rows_total;

  forced := current_setting('stone.force_drop', true);
  RAISE NOTICE 'الصفوف المهدَّدة: %  ·  التخطّي الصريح: %', rows_total, COALESCE(forced, 'غير مضبوط');

  IF rows_total > 0 AND COALESCE(forced, '') <> 'yes' THEN
    RAISE EXCEPTION
      'GATE FAILED: % صفّاً في جداول Stone — الحذف يمحوها ولا مصدرَ يُرجعها. اضبط stone.force_drop بعد نسخةٍ محقَّقة',
      rows_total;
  END IF;
END $$;

-- ── الحذف بترتيبٍ يحترم المفاتيح الأجنبيّة ───────────────────────────────
DROP TABLE IF EXISTS stone_bank_confirmations;
DROP TABLE IF EXISTS stone_interest_terms;
DROP TABLE IF EXISTS stone_open_items;
DROP TABLE IF EXISTS stone_vessels;
DROP TABLE IF EXISTS stone_fund_calls;
DROP TABLE IF EXISTS stone_investment_ledger;
DROP TABLE IF EXISTS stone_parent_ledger;
DROP TABLE IF EXISTS stone_rounds;

-- ── تحقّق ────────────────────────────────────────────────────────────────
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM information_schema.tables
  WHERE table_schema = 'public'
    AND table_name IN ('stone_rounds','stone_parent_ledger','stone_investment_ledger',
                       'stone_bank_confirmations','stone_fund_calls','stone_vessels',
                       'stone_open_items','stone_interest_terms');
  IF n <> 0 THEN
    RAISE EXCEPTION 'التراجع لم يكتمل: بقي % جدولاً', n;
  END IF;
  RAISE NOTICE 'التراجع تمّ — لا جداول Stone';
END $$;

COMMIT;
