-- ============================================================================
--  هجرة: مصاريف المركب من دفتر الشركة (QuickBooks COGS) — لكارت الربحيّة
--  جدولٌ واحدٌ جديد  ·  بأمر المالك في ٨ سبتمبر ٢٠٢٦
--
--  لماذا
--  -----
--  كارت ربحيّة بوسيدون يقرأ مصاريف الرحلات من الدفتر، وتنقصه مصاريف الشركة
--  المسجَّلة في QuickBooks: الصيانة والتموينات والإدارة الفنّيّة والمرتّبات
--  ورسوم الميناء المصريّ وعمولة الوكالة. والملفّ يصل شهريّاً بكامل السنة،
--  فيُرحَّل الجديد وحده ببصمةٍ لكلّ قيد (`dedupe_key`).
--
--  ولماذا لا جدول الفواتير: هذه القيود سُدّدت في QuickBooks أصلاً، وجدول
--  `invoices` دورةُ دفعٍ تُظهرها ديوناً مستحقّة وتُلوّث كشوف المورّدين.
--
--  والمستبعَد يُحفظ بعلامة `charged = false` وسببه، فلا يعود «جديداً» في
--  الاستيراد التالي.
--
--  الأمان
--  ------
--  إنشاءٌ محض: جدولٌ جديدٌ لا وجود له، ولا صفَّ يُكتب هنا، ولا جدولَ قائمٌ يُمسّ.
--  متكرّرة الأمان: `IF NOT EXISTS` في الجدول والفهارس.
--
--  التشغيل:  node scripts/run-migration.js docs/vessel-cogs-up.sql
--  التراجع:  docs/vessel-cogs-down.sql
-- ============================================================================

BEGIN;

DO $$
BEGIN
  RAISE NOTICE 'قبل الهجرة: vessel_cogs_entries %',
    CASE WHEN EXISTS (SELECT 1 FROM information_schema.tables
                      WHERE table_schema = 'public' AND table_name = 'vessel_cogs_entries')
         THEN 'موجودٌ سلفاً — لا يُعاد إنشاؤه' ELSE 'غير موجود — يُنشأ' END;
END $$;

CREATE TABLE IF NOT EXISTS vessel_cogs_entries (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vessel              varchar(120)   NOT NULL,
  source              varchar(20)    NOT NULL DEFAULT 'quickbooks',
  dedupe_key          varchar(64)    NOT NULL,
  batch_code          varchar(60)    NOT NULL DEFAULT '',
  account_code        varchar(20)    NOT NULL DEFAULT '',
  account_path        varchar(200)   NOT NULL DEFAULT '',
  doc_type            varchar(30)    NOT NULL DEFAULT '',
  entry_date          date           NOT NULL,
  doc_number          varchar(100)   NOT NULL DEFAULT '',
  supplier            varchar(200)   NOT NULL DEFAULT '',
  memo                text           NOT NULL DEFAULT '',
  amount_usd          numeric(15,2)  NOT NULL,
  amount_book         numeric(15,2),
  book_currency       varchar(10)    NOT NULL DEFAULT 'EUR',
  category            varchar(40)    NOT NULL,
  item_label          varchar(120)   NOT NULL,
  depreciation_months smallint,
  charged             boolean        NOT NULL DEFAULT true,
  exclude_reason      varchar(200)   NOT NULL DEFAULT '',
  note                text           NOT NULL DEFAULT '',
  created_by          varchar(120)   NOT NULL DEFAULT '',
  created_at          timestamptz    NOT NULL DEFAULT now()
);

-- أسماء الفهارس كما يولّدها TypeORM من الكيان — ليطابقها ولا يُسقطها
CREATE UNIQUE INDEX IF NOT EXISTS "UQ_vessel_cogs_entries_dedupe_key" ON vessel_cogs_entries (dedupe_key);
CREATE INDEX IF NOT EXISTS "IDX_vessel_cogs_entries_vessel" ON vessel_cogs_entries (vessel);
CREATE INDEX IF NOT EXISTS "IDX_vessel_cogs_entries_entry_date" ON vessel_cogs_entries (entry_date);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                 WHERE table_schema = 'public' AND table_name = 'vessel_cogs_entries') THEN
    RAISE EXCEPTION 'VERIFY FAILED: vessel_cogs_entries لم يُنشأ';
  END IF;
  RAISE NOTICE 'بعد الهجرة: vessel_cogs_entries موجود · صفوفه %', (SELECT count(*) FROM vessel_cogs_entries);
END $$;

COMMIT;
