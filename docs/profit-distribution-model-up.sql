-- ============================================================================
--  هجرة: مدخلات معادلة المستند المعتمد لتوزيع الأرباح
--  الجدول: profit_periods   ·   ٢٨ عموداً جديداً
--
--  لماذا
--  ------
--  المعادلة السابقة تبدأ من الإيراد، والمستند المعتمد يبدأ من النقد المتاح
--  في ضبا. فلزمت مدخلاتٌ لا وجود لها في المخطط: أساس العمولة، والوقود،
--  ونقد ضبا، وصافي التحصيل في صفاجا، والسعر اليوميّ، والتعديلات اليدويّة.
--
--  الأمان
--  ------
--  إضافةٌ محضة: لا عمود يُحذف، ولا نوع يتغيّر، ولا صفٌّ يُكتب. كل عمود
--  NOT NULL DEFAULT فيملأ الصفوف القائمة بالقيمة الافتراضية دون لمس بياناتها.
--  والصف الوحيد القائم (week 40) سيظهر بعدها «مدخلات ناقصة» — وهو الصواب:
--  نقد ضبا لم يُدخَل بعد، والتوزيع لا يُحتسب بدونه.
--
--  متكرّرة الأمان: IF NOT EXISTS على كل عمود، فإعادة التشغيل بلا أثر.
--  معامَلاتية: BEGIN/COMMIT — فشل أي بوابة يتراجع بالكامل.
--
--  التشغيل:  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f profit-distribution-model-up.sql
--  التراجع:  profit-distribution-model-down.sql
-- ============================================================================

\set ON_ERROR_STOP on

BEGIN;

-- ── بوابة ١: الجدول موجود ──────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'profit_periods'
  ) THEN
    RAISE EXCEPTION 'GATE 1 FAILED: جدول profit_periods غير موجود';
  END IF;
END $$;

-- ── بوابة ٢: الأعمدة القديمة سليمة — لا نبني على مخطط لا نعرفه ────────────
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM information_schema.columns
  WHERE table_name = 'profit_periods'
    AND column_name IN ('poseidon_revenue','amal_revenue','daleela_revenue',
                        'commission_rate','per_voyage_fee','ratio_badawi');
  IF n <> 6 THEN
    RAISE EXCEPTION 'GATE 2 FAILED: الأعمدة القديمة المتوقّعة ٦ ووُجد %', n;
  END IF;
END $$;

-- ── الأعمدة الجديدة ────────────────────────────────────────────────────────
--
--  لكل مركب ثمانية حقول ومعها تسوية الإيقاف:
--    sd_base        أساس العمولة — مجموع trE، شاحنات رحلة الذهاب
--    sd_adjust      تعديل يدويّ عليه، يستوجب سبباً في adjust_reason
--    fuel           الوقود — مجموع bnk
--    fuel_adjust    تعديل يدويّ عليه
--    cash_duba      النقد المتاح في ضبا — أساس التوزيع كلّه
--    net_collected  صافي التحصيل في صفاجا — تقوم عليه تسوية صفاجا
--    liquidity      سيولة الدفتر liq — تُخزَّن للمقارنة لا للحساب
--    daily_rate     السعر اليوميّ للإيجار
--    off_hire       تسوية إيقاف المركب — تُخزَّن ولا تُحتسب

ALTER TABLE profit_periods
  ADD COLUMN IF NOT EXISTS poseidon_sd_base       numeric(15,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS poseidon_sd_adjust     numeric(15,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS poseidon_fuel          numeric(15,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS poseidon_fuel_adjust   numeric(15,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS poseidon_cash_duba     numeric(15,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS poseidon_net_collected numeric(15,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS poseidon_liquidity     numeric(15,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS poseidon_daily_rate    numeric(12,2) NOT NULL DEFAULT 14000,
  ADD COLUMN IF NOT EXISTS poseidon_off_hire      numeric(15,4) NOT NULL DEFAULT 0;

ALTER TABLE profit_periods
  ADD COLUMN IF NOT EXISTS amal_sd_base       numeric(15,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS amal_sd_adjust     numeric(15,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS amal_fuel          numeric(15,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS amal_fuel_adjust   numeric(15,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS amal_cash_duba     numeric(15,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS amal_net_collected numeric(15,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS amal_liquidity     numeric(15,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS amal_daily_rate    numeric(12,2) NOT NULL DEFAULT 13000,
  ADD COLUMN IF NOT EXISTS amal_off_hire      numeric(15,4) NOT NULL DEFAULT 0;

ALTER TABLE profit_periods
  ADD COLUMN IF NOT EXISTS daleela_sd_base       numeric(15,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS daleela_sd_adjust     numeric(15,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS daleela_fuel          numeric(15,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS daleela_fuel_adjust   numeric(15,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS daleela_cash_duba     numeric(15,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS daleela_net_collected numeric(15,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS daleela_liquidity     numeric(15,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS daleela_daily_rate    numeric(12,2) NOT NULL DEFAULT 12000,
  ADD COLUMN IF NOT EXISTS daleela_off_hire      numeric(15,4) NOT NULL DEFAULT 0;

-- سبب التعديل اليدويّ — لا تسويةَ بلا سبب
ALTER TABLE profit_periods
  ADD COLUMN IF NOT EXISTS adjust_reason text;

-- ── بوابة ٣: الأعمدة الثمانية والعشرون كلها موجودة ────────────────────────
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM information_schema.columns
  WHERE table_name = 'profit_periods'
    AND (column_name LIKE '%\_sd\_base'       OR column_name LIKE '%\_sd\_adjust'
      OR column_name LIKE '%\_fuel'           OR column_name LIKE '%\_fuel\_adjust'
      OR column_name LIKE '%\_cash\_duba'     OR column_name LIKE '%\_net\_collected'
      OR column_name LIKE '%\_liquidity'      OR column_name LIKE '%\_daily\_rate'
      OR column_name LIKE '%\_off\_hire'      OR column_name = 'adjust_reason');
  IF n <> 28 THEN
    RAISE EXCEPTION 'GATE 3 FAILED: الأعمدة الجديدة المتوقّعة ٢٨ ووُجد %', n;
  END IF;
END $$;

-- ── بوابة ٤: لا صفَّ فقد بياناته القديمة ──────────────────────────────────
--  الإضافة محضة، فالبصمة المالية للأعمدة القديمة يجب أن تبقى كما هي.
--  تُقارن بما طُبع قبل التنفيذ في preflight.
DO $$
DECLARE rows_now int; sum_now numeric;
BEGIN
  SELECT count(*), COALESCE(sum(poseidon_revenue + amal_revenue + daleela_revenue), 0)
    INTO rows_now, sum_now FROM profit_periods;
  RAISE NOTICE 'بعد الهجرة: % صفّاً · مجموع الإيراد %', rows_now, sum_now;
END $$;

COMMIT;
