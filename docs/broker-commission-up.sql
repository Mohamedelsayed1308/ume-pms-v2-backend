-- ============================================================================
--  هجرة: عمولة البروكر على فواتير الإيجار
--  ثلاثة جداول: brokers · broker_rules · broker_ledger
--
--  لماذا
--  ------
--  كلّ فاتورة إيجارٍ تُصدَر إلى `Africa Morocco Links S.A` عن `Wasa Express`
--  أو `Monte Express` يستحقّ عليها **بروكران** ١.٢٥٪ لكلٍّ من إجماليها:
--  `Hammer Ship` و`Stena RORO`.
--
--  وكان يُتابَع خارج النظام. فصار: تُصدَر الفاتورة → يُقيَّد الاستحقاق →
--  يُتابَع → يُسدَّد → ويُطبع كشفُ حسابٍ لكلّ بروكر.
--
--  ── قراراتٌ مثبتة (٢٤ أغسطس ٢٠٢٦) ──
--    · الاستحقاق **عند إصدار الفاتورة** لا عند تحصيلها.
--    · **الإشعارات الدائنة لا علاقة لها** — الأساس إجمالي الفاتورة وحده،
--      والإشعار مستندٌ مستقلّ لا يُنقص عمولةً.
--    · القاعدة: أيّ فاتورةٍ لهذا العميل عن أيٍّ من المركبين.
--    · وتسري على ما يُصدَر من اليوم، **وعلى أيّ فاتورةٍ قديمة تُعدَّل**.
--
--  البنية
--  ------
--  `broker_rules` يجعل القاعدة **بياناً لا كوداً**: تُضيف بروكراً أو تُغيّر
--  نسبةً أو تُوقف قاعدةً بلا نشر. و`vessel_id` فارغاً يعني «كلّ المراكب».
--
--  `broker_ledger` حسابٌ جارٍ كحساب الشركاء: `due` استحقاقٌ موجب، و`payment`
--  سدادٌ سالب، والرصيد مجموع القيود — يُشتقّ ولا يُخزَّن.
--
--  الأمان
--  ------
--  جداولٌ جديدة فارغة، ولا يُمسّ جدولٌ قائم. والبذرة تُدخل البروكرين والقاعدتين
--  بـ `ON CONFLICT DO NOTHING` فإعادة التشغيل بلا أثر.
--
--  التشغيل:  node scripts/run-migration.js docs/broker-commission-up.sql
--  التراجع:  broker-commission-down.sql
-- ============================================================================

BEGIN;

-- ── بوابة ١: الجداول التي تعتمد عليها القاعدة موجودة ────────────────────
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM information_schema.tables
  WHERE table_name IN ('hire_invoices', 'customers', 'vessels');
  IF n <> 3 THEN
    RAISE EXCEPTION 'GATE 1 FAILED: الجداول المطلوبة غير مكتملة (وُجد %)', n;
  END IF;
END $$;

-- ── الجداول ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS brokers (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        varchar(200) NOT NULL UNIQUE,
  active      boolean NOT NULL DEFAULT true,
  notes       text NOT NULL DEFAULT '',
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS broker_rules (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  broker_id   uuid NOT NULL REFERENCES brokers(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  -- فارغاً يعني: كلّ مراكب هذا العميل
  vessel_id   uuid REFERENCES vessels(id) ON DELETE CASCADE,
  rate        decimal(8,4) NOT NULL,
  currency    varchar(10) NOT NULL DEFAULT 'EUR',
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS broker_rules_lookup_idx
  ON broker_rules (customer_id, vessel_id) WHERE active;

CREATE TABLE IF NOT EXISTS broker_ledger (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  broker_id       uuid NOT NULL REFERENCES brokers(id) ON DELETE CASCADE,
  -- الفاتورة التي وُلد عنها الاستحقاق · أو التي يُسدَّد عنها
  hire_invoice_id uuid REFERENCES hire_invoices(id) ON DELETE CASCADE,
  occurred_at     timestamptz NOT NULL DEFAULT now(),
  -- 'due' استحقاقٌ موجب · 'payment' سدادٌ سالب
  kind            varchar(20) NOT NULL,
  amount          decimal(15,2) NOT NULL,
  currency        varchar(10) NOT NULL DEFAULT 'EUR',
  -- أساس العمولة والنسبة — يُحفظان مع القيد ليُراجَع الرقم بعد سنة
  base_amount     decimal(15,2) NOT NULL DEFAULT 0,
  rate            decimal(8,4) NOT NULL DEFAULT 0,
  reference       varchar(200) NOT NULL DEFAULT '',
  note            text NOT NULL DEFAULT '',
  created_by      varchar(200) NOT NULL DEFAULT '',
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS broker_ledger_broker_idx  ON broker_ledger (broker_id, occurred_at);
CREATE INDEX IF NOT EXISTS broker_ledger_invoice_idx ON broker_ledger (hire_invoice_id);

/*
 * قيدُ استحقاقٍ واحدٌ لكلّ (فاتورة · بروكر).
 *
 * فتعديلُ الفاتورة يُحدّثه ولا يُضيف ثانياً — ولولا هذا لتضاعف الاستحقاق مع
 * كلّ حفظ. والسداد لا يُقيَّد عليه فهرسٌ فريد: قد يُسدَّد على دفعات.
 */
CREATE UNIQUE INDEX IF NOT EXISTS broker_ledger_one_due_idx
  ON broker_ledger (hire_invoice_id, broker_id)
  WHERE kind = 'due' AND hire_invoice_id IS NOT NULL;

-- ── البذرة: البروكران وقاعدتاهما ────────────────────────────────────────
INSERT INTO brokers (name, notes) VALUES
  ('Hammer Ship', 'بروكر — عمولة ١.٢٥٪ على فواتير إيجار Africa Morocco Links'),
  ('Stena RORO',  'بروكر — عمولة ١.٢٥٪ على فواتير إيجار Africa Morocco Links')
ON CONFLICT (name) DO NOTHING;

/*
 * القاعدة: العميل + المركب + البروكر + النسبة.
 *
 * وتُكتب بأسماء العميل والمراكب لا بمعرّفاتها — فالمعرّفات تختلف بين البيئات،
 * والاسم هو ما كتبه المالك. وإن لم يوجد الاسم لم تُكتب قاعدة، والبوّابة تُبلّغ.
 */
INSERT INTO broker_rules (broker_id, customer_id, vessel_id, rate, currency)
SELECT b.id, c.id, v.id, 1.25, 'EUR'
FROM brokers b
CROSS JOIN customers c
CROSS JOIN vessels v
WHERE b.name IN ('Hammer Ship', 'Stena RORO')
  AND c.name = 'Africa Morocco Links S.A'
  AND v.name IN ('Wasa Express', 'Monte Express')
  AND NOT EXISTS (
    SELECT 1 FROM broker_rules r
    WHERE r.broker_id = b.id AND r.customer_id = c.id AND r.vessel_id = v.id
  );

-- ── بوابة ٢: البذرة اكتملت ──────────────────────────────────────────────
DO $$
DECLARE nb int; nr int; led int;
BEGIN
  SELECT count(*) INTO nb FROM brokers WHERE name IN ('Hammer Ship', 'Stena RORO');
  IF nb <> 2 THEN
    RAISE EXCEPTION 'GATE 2 FAILED: البروكران لم يُنشآ (وُجد %)', nb;
  END IF;

  SELECT count(*) INTO nr FROM broker_rules r
    JOIN brokers b   ON b.id = r.broker_id
    JOIN customers c ON c.id = r.customer_id
    JOIN vessels v   ON v.id = r.vessel_id
   WHERE c.name = 'Africa Morocco Links S.A'
     AND v.name IN ('Wasa Express', 'Monte Express');
  IF nr <> 4 THEN
    RAISE EXCEPTION
      'GATE 2 FAILED: المتوقّع ٤ قواعد (بروكران × مركبان) ووُجد % — راجع أسماء العميل والمراكب', nr;
  END IF;

  SELECT count(*) INTO led FROM broker_ledger;
  IF led <> 0 THEN
    RAISE NOTICE 'الدفتر ليس فارغاً (% قيداً) — الهجرة أُعيدت وهذا لا يضرّ', led;
  END IF;

  RAISE NOTICE 'تمّ: % بروكراً · % قاعدة · % قيداً في الدفتر', nb, nr, led;
END $$;

COMMIT;
