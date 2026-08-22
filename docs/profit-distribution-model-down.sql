-- ============================================================================
--  تراجع: مدخلات معادلة المستند المعتمد لتوزيع الأرباح
--
--  ⚠ اقرأ قبل التشغيل
--  ------------------
--  هذا التراجع **يُتلف بيانات**. الأعمدة تحمل مدخلاتٍ لا مصدر لها إلا اليد:
--  نقد ضبا، وصافي التحصيل في صفاجا، و Over Pax، والتعديلات وأسبابها. لا
--  يُشتقّ شيءٌ منها من الشيت ولا من دفتر الرحلات، فإسقاطها فقدٌ نهائيّ.
--
--  ولا حاجة إليه لإرجاع الكود: مع synchronize=false صار git revert آمناً —
--  الكود يرجع والمخطط لا يتأثر، وأعمدةٌ زائدة لا تضرّ كياناً لا يعرفها.
--  فلا تُشغّله إلا بقرارٍ صريح على إزالة النموذج نفسه.
--
--  قبله: خُذ لقطةً للصفوف المتأثرة والتزمها في المستودع —
--    psql "$DATABASE_URL" -c "\copy (SELECT * FROM profit_periods) TO 'profit_periods_snapshot.csv' CSV HEADER"
--
--  التشغيل:  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f profit-distribution-model-down.sql
-- ============================================================================

\set ON_ERROR_STOP on

BEGIN;

-- ── بوابة: لا تُسقط عموداً فيه بياناتٌ مُدخَلة إلا بعد إعلانها ─────────────
DO $$
DECLARE touched int;
BEGIN
  SELECT count(*) INTO touched FROM profit_periods
  WHERE poseidon_cash_duba <> 0 OR amal_cash_duba <> 0 OR daleela_cash_duba <> 0
     OR poseidon_net_collected <> 0 OR amal_net_collected <> 0 OR daleela_net_collected <> 0
     OR COALESCE(adjust_reason, '') <> '';
  IF touched > 0 THEN
    RAISE WARNING 'تراجع مُتلِف: % صفّاً يحمل مدخلات خزينة أو سبب تعديل — تُفقد نهائياً', touched;
  END IF;
END $$;

ALTER TABLE profit_periods
  DROP COLUMN IF EXISTS poseidon_sd_base,
  DROP COLUMN IF EXISTS poseidon_sd_adjust,
  DROP COLUMN IF EXISTS poseidon_fuel,
  DROP COLUMN IF EXISTS poseidon_fuel_adjust,
  DROP COLUMN IF EXISTS poseidon_cash_duba,
  DROP COLUMN IF EXISTS poseidon_net_collected,
  DROP COLUMN IF EXISTS poseidon_liquidity,
  DROP COLUMN IF EXISTS poseidon_daily_rate,
  DROP COLUMN IF EXISTS poseidon_off_hire;

ALTER TABLE profit_periods
  DROP COLUMN IF EXISTS amal_sd_base,
  DROP COLUMN IF EXISTS amal_sd_adjust,
  DROP COLUMN IF EXISTS amal_fuel,
  DROP COLUMN IF EXISTS amal_fuel_adjust,
  DROP COLUMN IF EXISTS amal_cash_duba,
  DROP COLUMN IF EXISTS amal_net_collected,
  DROP COLUMN IF EXISTS amal_liquidity,
  DROP COLUMN IF EXISTS amal_daily_rate,
  DROP COLUMN IF EXISTS amal_off_hire;

ALTER TABLE profit_periods
  DROP COLUMN IF EXISTS daleela_sd_base,
  DROP COLUMN IF EXISTS daleela_sd_adjust,
  DROP COLUMN IF EXISTS daleela_fuel,
  DROP COLUMN IF EXISTS daleela_fuel_adjust,
  DROP COLUMN IF EXISTS daleela_cash_duba,
  DROP COLUMN IF EXISTS daleela_net_collected,
  DROP COLUMN IF EXISTS daleela_liquidity,
  DROP COLUMN IF EXISTS daleela_daily_rate,
  DROP COLUMN IF EXISTS daleela_off_hire;

ALTER TABLE profit_periods
  DROP COLUMN IF EXISTS adjust_reason;

COMMIT;
