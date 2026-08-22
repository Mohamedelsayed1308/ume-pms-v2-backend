-- ============================================================================
--  تراجع: تفصيل رحلات فترة التوزيع
--
--  ⚠ يُتلف بيانات
--  --------------
--  العمود يحمل **لقطة** لحال الدفتر لحظة الجلب — ودفتر المركب يتغيّر. فإسقاطه
--  يمحو الدليل على ما حُسب منه التوزيع، ولا يُستعاد بإعادة الجلب: إعادة الجلب
--  تُحضر حال الدفتر **اليوم** لا حاله يومئذٍ.
--
--  ولا حاجة إليه لإرجاع الكود: مع synchronize=false صار git revert آمناً —
--  الكود يرجع والمخطط لا يتأثر، وعمودٌ زائد لا يضرّ كياناً لا يعرفه.
--
--  قبله: خُذ لقطةً للصفوف التي تحمل تفصيلاً —
--    psql "$DATABASE_URL" -c "\copy (SELECT id, period_name, voyage_detail FROM profit_periods WHERE voyage_detail IS NOT NULL) TO 'voyage_detail_snapshot.csv' CSV HEADER"
--
--  التشغيل:  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f profit-voyage-detail-down.sql
-- ============================================================================

\set ON_ERROR_STOP on

BEGIN;

DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM profit_periods WHERE voyage_detail IS NOT NULL;
  IF n > 0 THEN
    RAISE WARNING 'تراجع مُتلِف: % فترةً تحمل تفصيل رحلات — يُفقد نهائياً', n;
  END IF;
END $$;

ALTER TABLE profit_periods
  DROP COLUMN IF EXISTS voyage_detail;

COMMIT;
