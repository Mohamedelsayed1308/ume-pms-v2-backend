-- ============================================================================
--  هجرة: كارت متابعة استثمار Stone Shipping
--  ثمانية جداول جديدة  ·  بأمر المالك في ٢٨ أغسطس ٢٠٢٦
--
--  ما يتتبّعه
--  ----------
--  دورةٌ رباعيّةٌ بين ثلاث جهات:
--
--      UME Holdings ──① تغذية ──▶ Bee Shipping ──② مساهمة ──▶ Stone
--         (الأمّ)   ◀── ④ سداد ──   (التابعة)   ◀── ③ استرداد ──
--                        + فائدة
--
--  الأمّ تُقرض التابعة لتدخل استثماراً في Stone. فالكارت يتابع: كم اقتُرض،
--  وكم استُثمر، وكم عاد، وكم سُدّد، وما الفائدة.
--
--  ولماذا دفترٌ مستقلٌّ لا كيانٌ محاسبيّ
--  ------------------------------------
--  بقرار المالك: «ليس لها كيانٌ محاسبيّ على النظام… أريد الدفتر كياناً بسيطاً».
--  فلا `legal_entity` ولا قيود `GJ` ولا ترحيل. والكارت يقرأ ويكتب في جداوله
--  وحدها — وقيدٌ خاطئٌ فيه يُصحَّح، ولا يلوّث دفتر المجموعة.
--
--  والرصيد يُشتقّ ولا يُخزَّن
--  ------------------------
--  على نمط حساب الشركاء الجاري: `المقترض القائم = Σ التغذيات − Σ سدادات الأصل`.
--  فلا رقمٌ محفوظٌ يستطيع أن يخالف مكوّناته — وهي العلّة نفسها التي جعلت رحلةً
--  في دفتر بيلاجوس تحمل صافياً يناقض أعمدته.
--
--  الأمان
--  ------
--  إنشاءٌ محضٌ: ثمانية جداول جديدة لا وجود لها اليوم. **ولا صفَّ يُكتب هنا** —
--  البذر يتمّ من الشاشة ليُرى قبل أن يُحفظ. ولا جدول قائم يُمسّ ولا عمود.
--
--  والهجرة متكرّرة الأمان: `IF NOT EXISTS` في كلّ إنشاء، والبوّابة تتحقّق من
--  البنية لا من الفراغ — فإعادة تشغيلها بعد إدخال بياناتٍ لا تُسقطها.
--
--  التشغيل:  node scripts/run-migration.js docs/stone-investment-up.sql
--  التراجع:  docs/stone-investment-down.sql
-- ============================================================================

BEGIN;

-- ── بوابة ١: لا يوجد جدولٌ باسمٍ من أسمائنا يخصّ شيئاً آخر ────────────────
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM information_schema.tables
  WHERE table_schema = 'public'
    AND table_name IN ('stone_rounds','stone_parent_ledger','stone_investment_ledger',
                       'stone_bank_confirmations','stone_fund_calls','stone_vessels',
                       'stone_open_items','stone_interest_terms');
  RAISE NOTICE 'قبل الهجرة: % من جداول Stone موجودةٌ سلفاً', n;
  IF n NOT IN (0, 8) THEN
    RAISE EXCEPTION
      'GATE 1 FAILED: وُجد % جدولاً فقط — تركيبةٌ جزئيّةٌ لا تُبنى فوقها. راجع قبل الإعادة', n;
  END IF;
END $$;

-- ── الجولات ──────────────────────────────────────────────────────────────
/*
 * الجولة بيانٌ لا كود.
 *
 * اليوم جولتان (٧ و٨)، وتاسعةٌ محتملة. فإضافتها سطرٌ يُدخَل من الشاشة، لا
 * نشرةٌ تُطلَق.
 */
CREATE TABLE IF NOT EXISTS stone_rounds (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  round_no          smallint NOT NULL UNIQUE,
  commitment_usd    numeric(18,2) NOT NULL,
  plsa_signed_date  date,
  status            varchar(60) NOT NULL DEFAULT '',
  note              text NOT NULL DEFAULT '',
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- ── دفتر الأمّ · UME Holdings ↔ Bee ──────────────────────────────────────
/*
 * حركةٌ واحدةٌ بحقلين يُحدّدان معناها:
 *
 *   direction = 'funding'   الأمّ تُقرض التابعة   (نزولاً)
 *             = 'repayment' التابعة تسدّد للأمّ   (صعوداً)
 *   kind      = 'principal' أصلٌ يُنقص المديونيّة
 *             = 'interest'  فائدةٌ تُتابَع منفصلةً فلا تختلط بالأصل
 *
 * والمبلغ **موجبٌ دائماً** — الاتّجاه يحمل الإشارة. فرقمٌ سالبٌ في عمودٍ
 * يعني أمرين لمن يقرأه، والفصلُ يقطع اللبس.
 */
CREATE TABLE IF NOT EXISTS stone_parent_ledger (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at  date NOT NULL,
  direction    varchar(20) NOT NULL CHECK (direction IN ('funding','repayment')),
  kind         varchar(20) NOT NULL DEFAULT 'principal' CHECK (kind IN ('principal','interest')),
  amount_usd   numeric(18,2) NOT NULL CHECK (amount_usd > 0),
  round_id     uuid REFERENCES stone_rounds(id) ON DELETE SET NULL,
  reference    varchar(160) NOT NULL DEFAULT '',
  note         text NOT NULL DEFAULT '',
  created_by   varchar(120) NOT NULL DEFAULT '',
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS stone_parent_ledger_date_idx ON stone_parent_ledger (occurred_at);

-- ── دفتر الاستثمار · Bee ↔ Stone ─────────────────────────────────────────
/*
 * ── ولماذا تاريخان ──
 * ملفّا Stone وسجلّ Bee يحملان المبالغ نفسها بتواريخ مختلفة: من صفرٍ إلى اثني
 * عشر يوماً، متوسّطها ٤.٨. فالأوّل تاريخ **النداء** والثاني تاريخ **الدفع**.
 * وحفظُ واحدٍ منهما يجعل التوفيق بين المصدرين مستحيلاً.
 *
 * ── و`source` يُبقي الفجوة مرئيّة ──
 * شيت Stone يحمل ١٩ قيداً بمجموع 1,137,500 — وهو ٩١٪ من الالتزام بالدولار،
 * مطابقٌ لما نادى به الصندوق. ودفتر Bee يحمل ٢٢ بمجموع 1,272,500.
 * والقيود الثلاثة الزائدة تُطابق أقساط الجولة ٨ الأولى مبلغاً، بفارق ٦–٨ أيام
 * — فيُرجَّح أنّها جولة ٨ قُيّدت في حساب الجولة ٧.
 *
 * ولا يُنقل قيدٌ بظنّ: `suspect_round_id` يُعلن الشكّ، والنقل بيد المالك.
 */
CREATE TABLE IF NOT EXISTS stone_investment_ledger (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id          uuid NOT NULL REFERENCES stone_rounds(id) ON DELETE CASCADE,
  direction         varchar(20) NOT NULL CHECK (direction IN ('contribution','repatriation')),
  seq               smallint,
  call_date         date,
  paid_date         date,
  amount_usd        numeric(18,2) NOT NULL CHECK (amount_usd > 0),
  pct_of_commitment numeric(9,6),
  ships             varchar(240) NOT NULL DEFAULT '',
  -- من أين عُرف هذا القيد — ودفتر Bee يفوز عند التعارض، بقرار المالك
  source            varchar(20) NOT NULL DEFAULT 'both'
                    CHECK (source IN ('stone_recap','bee_gl','both')),
  -- الاسترداد وحده يحمل حالة: أُعلن أم تأكّد وصوله
  status            varchar(20) CHECK (status IS NULL OR status IN ('announced','confirmed')),
  -- جولةٌ يُرجَّح أنّ القيد يخصّها لا الجولة المقيَّد فيها — إعلانُ شكٍّ لا نقل
  suspect_round_id  uuid REFERENCES stone_rounds(id) ON DELETE SET NULL,
  note              text NOT NULL DEFAULT '',
  created_by        varchar(120) NOT NULL DEFAULT '',
  created_at        timestamptz NOT NULL DEFAULT now(),
  -- تاريخٌ واحدٌ على الأقلّ، وإلا فالقيد بلا موضعٍ في الزمن
  CONSTRAINT stone_inv_has_a_date CHECK (call_date IS NOT NULL OR paid_date IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS stone_inv_round_idx ON stone_investment_ledger (round_id, direction);

-- ── تأكيدات التحويلات البنكيّة — سجلٌّ مستقلّ ────────────────────────────
/*
 * مستقلٌّ بأمر المالك، لا حقلاً على القيد.
 *
 * فتأكيدٌ واحدٌ قد يغطّي أكثر من قيد، وربطُه حقلاً يُجبر على تكرار المرجع في
 * كلّ سطرٍ يغطّيه. والربط هنا اختياريّ: تأكيدٌ يصل قبل أن يُقيَّد ما يؤكّده
 * يُحفظ ويُربط لاحقاً.
 */
CREATE TABLE IF NOT EXISTS stone_bank_confirmations (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at  date NOT NULL,
  bank         varchar(160) NOT NULL DEFAULT '',
  reference    varchar(200) NOT NULL DEFAULT '',
  amount_usd   numeric(18,2),
  -- ما يؤكّده: أيّ دفترٍ وأيّ قيد — وكلاهما اختياريّ
  links_table  varchar(30) CHECK (links_table IS NULL OR links_table IN ('parent_ledger','investment_ledger')),
  links_id     uuid,
  note         text NOT NULL DEFAULT '',
  created_by   varchar(120) NOT NULL DEFAULT '',
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- ── نداءات الصندوق ───────────────────────────────────────────────────────
/*
 * «الصندوق نادى كذا٪ بتاريخ كذا» — وهو المقياس الذي كشف أنّ سجلّ Stone
 * متناسبٌ تماماً: ٩١٪ من الصندوق، و٩١٪ من التزام Bee بالدولار الواحد.
 */
CREATE TABLE IF NOT EXISTS stone_fund_calls (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id        uuid NOT NULL REFERENCES stone_rounds(id) ON DELETE CASCADE,
  as_of           date NOT NULL,
  fund_called_usd numeric(18,2),
  pct             numeric(9,6),
  note            text NOT NULL DEFAULT '',
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- ── السفن المضافة ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS stone_vessels (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id         uuid REFERENCES stone_rounds(id) ON DELETE CASCADE,
  name             varchar(160) NOT NULL,
  vessel_type      varchar(120) NOT NULL DEFAULT '',
  built            smallint,
  hire             varchar(120) NOT NULL DEFAULT '',
  charter_period   varchar(120) NOT NULL DEFAULT '',
  delivery         varchar(120) NOT NULL DEFAULT '',
  pool_coefficient varchar(120) NOT NULL DEFAULT '',
  note             text NOT NULL DEFAULT '',
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- ── البنود المفتوحة ──────────────────────────────────────────────────────
/*
 * أحد عشر بنداً في مستند المالك، ولا حالةَ لأيٍّ منها. وقائمةٌ بلا حالةٍ
 * تُقرأ ولا تتحرّك — فأُضيفت الحالة والمسؤول والتاريخ.
 */
CREATE TABLE IF NOT EXISTS stone_open_items (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title       text NOT NULL,
  status      varchar(20) NOT NULL DEFAULT 'open' CHECK (status IN ('open','sent','closed')),
  owner       varchar(160) NOT NULL DEFAULT '',
  due_date    date,
  closed_date date,
  note        text NOT NULL DEFAULT '',
  sort_order  smallint NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- ── شروط الفائدة ─────────────────────────────────────────────────────────
/*
 * ── ولماذا `is_agreed` حقلٌ صريح ──
 * مستند المالك يقول التسهيل **بلا فائدة**، ويُنبّه أنّ المادّة ٣٣ القبرصيّة قد
 * تفرض فائدةً حكميّةً على قروض الأطراف المرتبطة.
 *
 * فالجدولُ فارغٌ اليوم، **والفراغ لا يُقرأ إقراراً**: الشاشة تقول «لا فائدةَ
 * مُتّفقٌ عليها» ما دام لا سطرَ هنا. ومتى أُدخل سطرٌ بـ `is_agreed = false`
 * حَسَب المحرّك فائدةً **تقديريّةً تُعرض ولا تُقيَّد** — والقيد لا يدخل دفتر
 * الأمّ إلا بمصادقةٍ صريحةٍ من المالك، بقرارٍ منه في ٢٨ أغسطس ٢٠٢٦.
 */
CREATE TABLE IF NOT EXISTS stone_interest_terms (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  effective_from date NOT NULL,
  rate_pct       numeric(9,4) NOT NULL CHECK (rate_pct >= 0),
  day_count      varchar(20) NOT NULL DEFAULT 'ACT/365',
  is_agreed      boolean NOT NULL DEFAULT false,
  note           text NOT NULL DEFAULT '',
  created_by     varchar(120) NOT NULL DEFAULT '',
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- ── بوابة ٢: الثمانية موجودةٌ ولا صفَّ كُتب ──────────────────────────────
DO $$
DECLARE n int; rows_total int;
BEGIN
  SELECT count(*) INTO n FROM information_schema.tables
  WHERE table_schema = 'public'
    AND table_name IN ('stone_rounds','stone_parent_ledger','stone_investment_ledger',
                       'stone_bank_confirmations','stone_fund_calls','stone_vessels',
                       'stone_open_items','stone_interest_terms');
  IF n <> 8 THEN
    RAISE EXCEPTION 'GATE 2 FAILED: المتوقّع ٨ جداول ووُجد %', n;
  END IF;

  /*
   * الهجرة **لا تبذر**. البذر من الشاشة ليُرى قبل أن يُحفظ — فرقمٌ يُكتب في
   * محرّر SQL لا يراجعه أحد، وهذه أموالٌ حقيقيّةٌ بين شركتين مرتبطتين.
   */
  SELECT (SELECT count(*) FROM stone_rounds)
       + (SELECT count(*) FROM stone_parent_ledger)
       + (SELECT count(*) FROM stone_investment_ledger)
       + (SELECT count(*) FROM stone_bank_confirmations)
       + (SELECT count(*) FROM stone_fund_calls)
       + (SELECT count(*) FROM stone_vessels)
       + (SELECT count(*) FROM stone_open_items)
       + (SELECT count(*) FROM stone_interest_terms)
    INTO rows_total;
  RAISE NOTICE 'بعد الهجرة: ٨ جداول · % صفّاً فيها جميعاً', rows_total;
END $$;

COMMIT;

-- ============================================================================
--  ولا بذرَ هنا.
--  الجولتان والقيود والبنود المفتوحة تُدخَل من الشاشة، ويُطبع تقرير بذرٍ
--  بكلّ فارقٍ بين مصدرَي البيانات قبل أن يُحفظ شيء.
-- ============================================================================
