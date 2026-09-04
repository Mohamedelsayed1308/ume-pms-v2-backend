-- ============================================================================
--  هجرة: نتائج الصندوق الربعيّة — لكارت Stone
--  جدولٌ واحدٌ جديد  ·  بأمر المالك في ٤ سبتمبر ٢٠٢٦
--
--  لماذا
--  -----
--  تقرير الإدارة يعرض «المكاسب» بتسميتين: **محقَّقةٌ** (نقدٌ عاد فوق رأس المال)
--  و**دفتريّة** (نصيب Bee من نتيجة الصندوق التراكميّة). والثانية لا تُشتقّ من
--  حركات Bee — مصدرها تقرير CTM الربعيّ: المسحوب على الصندوق، ونتيجته، وعدد
--  سفنه. فهذا الجدول يحمل تلك الأرقام بتاريخ كلّ تقرير، وتُدخَل يدويّاً.
--
--  نصيب Bee = الالتزام ÷ حجم الصندوق (2.5٪ في الجولة ٧ · 3٪ في الجولة ٨)،
--  ويُحسب عند كلّ نداء — لا يُخزَّن.
--
--  الأمان
--  ------
--  إنشاءٌ محض: جدولٌ جديدٌ لا وجود له، ولا صفَّ يُكتب هنا، ولا جدولَ قائمٌ يُمسّ.
--  متكرّرة الأمان: `IF NOT EXISTS`، والبوّابة تتحقّق من وجود `stone_rounds`
--  (فالجدول يشير إليه) لا من فراغٍ.
--
--  التشغيل:  node scripts/run-migration.js docs/stone-fund-reports-up.sql
--  التراجع:  docs/stone-fund-reports-down.sql
-- ============================================================================

BEGIN;

-- ── بوابة ١: كارت Stone موجود ───────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                 WHERE table_schema = 'public' AND table_name = 'stone_rounds') THEN
    RAISE EXCEPTION 'GATE 1 FAILED: جدول stone_rounds غير موجود — شغّل stone-investment-up.sql أوّلاً';
  END IF;
  RAISE NOTICE 'قبل الهجرة: stone_fund_reports %',
    CASE WHEN EXISTS (SELECT 1 FROM information_schema.tables
                      WHERE table_schema = 'public' AND table_name = 'stone_fund_reports')
         THEN 'موجودٌ سلفاً — لا يُعاد إنشاؤه' ELSE 'غير موجود — يُنشأ' END;
END $$;

-- ── الجدول ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS stone_fund_reports (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id               uuid NOT NULL REFERENCES stone_rounds(id) ON DELETE CASCADE,
  -- تاريخ نهاية الفترة التي يغطّيها التقرير (مثلاً 2026-06-30)
  as_of                  date NOT NULL,
  -- حجم الصندوق كاملاً — به يُحسب نصيب Bee
  fund_size_usd          numeric(18,2) NOT NULL CHECK (fund_size_usd > 0),
  -- المسحوب على الصندوق حتّى التاريخ
  fund_called_usd        numeric(18,2),
  -- نتيجة الفترة ونتيجة الصندوق التراكميّة منذ بدايته (قد تكون سالبة)
  result_period_usd      numeric(18,2),
  result_cumulative_usd  numeric(18,2) NOT NULL,
  -- ما ردّه الصندوق للمستثمرين حتّى التاريخ (على مستوى الصندوق)
  fund_repatriated_usd   numeric(18,2),
  vessels_count          smallint,
  -- من أين جاء الرقم: «CTM Q2 2026 report» ونحوه
  source                 varchar(200) NOT NULL DEFAULT '',
  note                   text NOT NULL DEFAULT '',
  created_by             varchar(120) NOT NULL DEFAULT '',
  created_at             timestamptz NOT NULL DEFAULT now(),
  -- تقريرٌ واحدٌ لكلّ جولةٍ في التاريخ الواحد
  CONSTRAINT stone_fund_reports_one_per_date UNIQUE (round_id, as_of)
);

CREATE INDEX IF NOT EXISTS stone_fund_reports_round_idx ON stone_fund_reports (round_id, as_of);

-- ── بوابة ٢: البنية كما نتوقّعها، ولا صفَّ كُتب ───────────────────────
DO $$
DECLARE cols int; rows_n int;
BEGIN
  SELECT count(*) INTO cols FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'stone_fund_reports';
  IF cols < 13 THEN
    RAISE EXCEPTION 'GATE 2 FAILED: stone_fund_reports فيه % عموداً — البنية ناقصة', cols;
  END IF;
  SELECT count(*) INTO rows_n FROM stone_fund_reports;
  RAISE NOTICE 'بعد الهجرة: stone_fund_reports بـ % عموداً و % صفّاً (الهجرة لا تكتب صفوفاً)', cols, rows_n;
END $$;

COMMIT;
