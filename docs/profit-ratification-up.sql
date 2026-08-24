-- ============================================================================
--  هجرة: المصادقة والرصيد التراكميّ
--  الجدول: profit_periods  ·  ثمانية أعمدة
--  وجدولٌ جديد: profit_settlements  ·  دفتر الفروق
--
--  لماذا
--  ------
--  التوزيع يصدر وفي مصاريفه **مبالغ تقديريّة** — رسوم ميناء مصر تُكتب ١١٬٥٠٠
--  في كلّ رحلة حتّى تصل الفاتورة. فالرقم المُحوَّل إلى البنك صدر على تقدير،
--  والفعليّ يأتي بعده فيتغيّر الشيت.
--
--  فيُجمَّد الرقم عند المصادقة، ويُقارَن بما يُسحب لاحقاً، ويتراكم الفرق في
--  رصيدٍ جارٍ للشريكين — ثمّ يُخصم أو يُجمع في المصادقة التالية.
--
--  ما يُضاف
--  --------
--  ١ · {مركب}_fuel_supply  —  بندٌ يدويّ يُضاف إلى التحويل لسداد مورّد الوقود.
--      وهو **غير** بنكر الدفتر: في مستند ١–١٥ أغسطس بنكر أمل ٣١٥٬٨٤١.٣٥ يُخصم
--      مناصفةً، و`Fuel Supply` صفر. وفي ٢٠ يونيو – ٣ يوليو بنكره ٣٠٥٬٢١٤.١٦
--      و`Fuel Supply` ١٢٥٬٦٥٨.٠٥ — جزءٌ منه لا كلّه. فهما بندان لا واحد.
--
--  ٢ · ratified_at · ratified_by · ratified_snapshot
--      اللقطة تحفظ **المدخلات والمخرجات معاً**: المدخلات ليُقارَن بها، والمخرجات
--      لأنّها الرقم الذي صدر ولا يجوز أن يتغيّر بعد اليوم.
--
--  ٣ · latest_snapshot · latest_fetched_at
--      بعد المصادقة تُقفل حقول الفترة، فلا يكتب فيها جلبٌ ولا حفظ. والسحب
--      الجديد يحتاج مكاناً يستقرّ فيه ليُقارَن — فهذا مكانه. ولولاه لضاع
--      المسحوب حديثاً أو لدَهَس المُجمَّد، وكلاهما يُفسد المصادقة.
--
--  ٤ · profit_settlements — دفترُ الفروق.
--      الرصيد الجاري **دفترٌ لا رقم**: كلّ فرقٍ يُقيَّد بتاريخه وسببه، وتسويته
--      قيدٌ مقابل. فيُسأل بعد سنة «من أين جاء هذا الرقم؟» فيوجد السطر.
--      ولو خُزّن رقماً واحداً لضاع تاريخه ولما أمكن مراجعته.
--
--  الأمان
--  ------
--  إضافةٌ محضة: أعمدةٌ قابلة للفراغ أو بافتراضٍ صفر، وجدولٌ جديد فارغ. لا
--  يُحذف عمود ولا يتغيّر نوع ولا يُكتب صفٌّ قائم.
--
--  متكرّرة الأمان: IF NOT EXISTS في الكلّ.
--
--  التشغيل:  محرّر SQL في Supabase — يُلصق كما هو
--  التراجع:  profit-ratification-down.sql
-- ============================================================================

BEGIN;

-- ── بوابة ١: الجدول والأعمدة التي تعتمد عليها الهجرة ─────────────────────
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM information_schema.columns
  WHERE table_name = 'profit_periods'
    AND column_name IN ('poseidon_fuel', 'amal_fuel', 'daleela_fuel',
                        'poseidon_over_pax_safaga', 'voyage_detail');
  IF n <> 5 THEN
    RAISE EXCEPTION 'GATE 1 FAILED: الأعمدة المتوقَّعة غير مكتملة (وُجد %) — هل نُفّذت هجرة Over Pax صفاجا؟', n;
  END IF;
END $$;

-- ── بوابة ٢: بصمةٌ قبليّة ────────────────────────────────────────────────
DO $$
DECLARE rows_before int; cols_before int;
BEGIN
  SELECT count(*) INTO cols_before FROM information_schema.columns
  WHERE table_name = 'profit_periods';
  SELECT count(*) INTO rows_before FROM profit_periods;
  RAISE NOTICE 'قبل الهجرة: % صفّاً · % عموداً', rows_before, cols_before;
END $$;

-- ── الأعمدة ──────────────────────────────────────────────────────────────
ALTER TABLE profit_periods
  ADD COLUMN IF NOT EXISTS poseidon_fuel_supply decimal(15,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS amal_fuel_supply     decimal(15,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS daleela_fuel_supply  decimal(15,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ratified_at          timestamptz,
  ADD COLUMN IF NOT EXISTS ratified_by          varchar(200),
  ADD COLUMN IF NOT EXISTS ratified_snapshot    jsonb,
  ADD COLUMN IF NOT EXISTS latest_snapshot      jsonb,
  ADD COLUMN IF NOT EXISTS latest_fetched_at    timestamptz;

-- ── دفتر الفروق ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS profit_settlements (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  period_id   uuid NOT NULL REFERENCES profit_periods(id) ON DELETE CASCADE,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  -- 'badawi' (UME · بوسيدون) أو 'ittihad' (أمل + دليلة)
  partner     varchar(20) NOT NULL,
  -- موجبٌ لصالح الشريك، سالبٌ عليه
  amount      decimal(15,4) NOT NULL,
  -- 'delta' فرقٌ رُصد · 'applied' تسويةٌ أُدخلت في مصادقةٍ تالية
  kind        varchar(20) NOT NULL,
  note        text NOT NULL DEFAULT '',
  created_by  varchar(200) NOT NULL DEFAULT '',
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS profit_settlements_period_idx
  ON profit_settlements (period_id);
CREATE INDEX IF NOT EXISTS profit_settlements_partner_idx
  ON profit_settlements (partner, occurred_at);

-- ── بوابة ٣: كلّ ما وُعد به أُنشئ ───────────────────────────────────────
DO $$
DECLARE n int; t int;
BEGIN
  SELECT count(*) INTO n FROM information_schema.columns
  WHERE table_name = 'profit_periods'
    AND column_name IN ('poseidon_fuel_supply', 'amal_fuel_supply', 'daleela_fuel_supply',
                        'ratified_at', 'ratified_by', 'ratified_snapshot',
                        'latest_snapshot', 'latest_fetched_at');
  IF n <> 8 THEN
    RAISE EXCEPTION 'GATE 3 FAILED: الأعمدة الثمانية لم تكتمل (وُجد %)', n;
  END IF;

  SELECT count(*) INTO t FROM information_schema.tables
  WHERE table_name = 'profit_settlements';
  IF t <> 1 THEN
    RAISE EXCEPTION 'GATE 3 FAILED: جدول الفروق لم يُنشأ';
  END IF;

  SELECT count(*) INTO n FROM information_schema.columns
  WHERE table_name = 'profit_settlements';
  IF n <> 9 THEN
    RAISE EXCEPTION 'GATE 3 FAILED: جدول الفروق فيه % عموداً لا ٩', n;
  END IF;
END $$;

-- ── بوابة ٤: لا فترةَ صارت مُصادَقةً بالخطأ، ولا قيدَ وُلد من العدم ──────
DO $$
DECLARE ratified int; settlements int; rows_after int; cols_after int;
BEGIN
  SELECT count(*) INTO ratified FROM profit_periods WHERE ratified_at IS NOT NULL;
  IF ratified <> 0 THEN
    RAISE EXCEPTION 'GATE 4 FAILED: % فترةً ظهرت مُصادَقة — الافتراض لم يُطبَّق', ratified;
  END IF;
  SELECT count(*) INTO settlements FROM profit_settlements;
  IF settlements <> 0 THEN
    RAISE EXCEPTION 'GATE 4 FAILED: دفتر الفروق ليس فارغاً (% قيداً)', settlements;
  END IF;

  SELECT count(*) INTO cols_after FROM information_schema.columns
  WHERE table_name = 'profit_periods';
  SELECT count(*) INTO rows_after FROM profit_periods;
  RAISE NOTICE 'بعد الهجرة: % صفّاً · % عموداً · دفتر الفروق فارغ',
    rows_after, cols_after;
  RAISE NOTICE 'المتوقّع: الصفوف كما هي · الأعمدة +٨';
END $$;

COMMIT;
