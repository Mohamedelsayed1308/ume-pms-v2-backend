/**
 * ── جدول إطفاء المصروفات المدفوعة مقدماً ──
 *
 * أصغر سجلٍّ يكفي للأتمتة: ما يُطفأ، وكم إجماليه، ومن متى إلى متى، وعلى أي
 * حساب مصروف. والقسط الشهري **لا يُخزَّن** — يُشتقّ من الإجمالي وعدد الأشهر
 * ليحمل الشهر الأخير باقيه، فيبلغ الحساب الصفر تماماً بلا رصيدٍ شبح.
 *
 * `end_month` مُلزِم كما في الإهلاك: جدولٌ بلا نهاية يُطفئ تحت الصفر بصمت،
 * والدفتر يبقى متوازناً فلا يشتكي أحد.
 */

export const PREPAID_SCHEDULE_UP: string[] = [
  /*
   * توسيع أنواع الأحداث بـ`amortization`.
   *
   * قيد `CHECK` على `journal_entries` يحصر النوع في قائمة مغلقة — وهو حارسٌ
   * مقصود. فإضافة نوعٍ للكود بلا تحديث القيد تجعل كل قيد إطفاء يُرفض من
   * القاعدة بعد أن يمرّ من التطبيق: خطأٌ لا يظهر إلا عند أول تشغيل حقيقي.
   *
   * القائمة تُعاد كاملةً لا تُضاف إليها — القيد يُستبدل لا يُعدَّل.
   */
  `ALTER TABLE journal_entries DROP CONSTRAINT IF EXISTS chk_je_event_type`,
  `ALTER TABLE journal_entries ADD CONSTRAINT chk_je_event_type CHECK (
     accounting_event_type IN (
       'manual','opening_balance','invoice_accrual','payment_settlement',
       'reversal','adjustment','depreciation','fx_revaluation','amortization'))`,

  `CREATE TABLE IF NOT EXISTS prepaid_schedules (
     id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     legal_entity_id       UUID NOT NULL,
     vessel_id             UUID,
     customer_id           UUID,
     description           VARCHAR(300),
     source_reference      VARCHAR(100),
     total_amount          NUMERIC(18,2) NOT NULL,
     start_month           CHAR(7) NOT NULL,
     end_month             CHAR(7) NOT NULL,
     prepaid_account_id    UUID NOT NULL,
     expense_account_id    UUID NOT NULL,
     journal_code          VARCHAR(10) NOT NULL DEFAULT 'GJ',
     is_active             BOOLEAN NOT NULL DEFAULT true,
     created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
     updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
     created_by            UUID
   )`,

  /*
   * قسطٌ ثابت اختياري.
   *
   * أصلٌ بدأ إطفاؤه في دفترٍ سابق له قسطٌ قائم لا يُشتقّ من رصيده المتبقّي —
   * وقسمةُ الباقي على مدّته تُنتج رقماً يخالف الدفتر الأصلي كل شهر. فارغاً
   * يعني القسمة بالتساوي كما كان.
   */
  `ALTER TABLE prepaid_schedules ADD COLUMN IF NOT EXISTS monthly_amount NUMERIC(18,2)`,

  `ALTER TABLE prepaid_schedules DROP CONSTRAINT IF EXISTS chk_ps_monthly`,
  `ALTER TABLE prepaid_schedules ADD CONSTRAINT chk_ps_monthly
     CHECK (monthly_amount IS NULL OR monthly_amount > 0)`,

  `ALTER TABLE prepaid_schedules DROP CONSTRAINT IF EXISTS chk_ps_amount`,
  `ALTER TABLE prepaid_schedules ADD CONSTRAINT chk_ps_amount CHECK (total_amount > 0)`,

  `ALTER TABLE prepaid_schedules DROP CONSTRAINT IF EXISTS chk_ps_months`,
  `ALTER TABLE prepaid_schedules ADD CONSTRAINT chk_ps_months CHECK (
     start_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'
     AND end_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'
     AND end_month >= start_month)`,

  `ALTER TABLE prepaid_schedules DROP CONSTRAINT IF EXISTS fk_ps_entity`,
  `ALTER TABLE prepaid_schedules ADD CONSTRAINT fk_ps_entity
     FOREIGN KEY (legal_entity_id) REFERENCES legal_entities(id) ON DELETE RESTRICT`,

  `ALTER TABLE prepaid_schedules DROP CONSTRAINT IF EXISTS fk_ps_prepaid`,
  `ALTER TABLE prepaid_schedules ADD CONSTRAINT fk_ps_prepaid
     FOREIGN KEY (prepaid_account_id) REFERENCES accounting_accounts(id) ON DELETE RESTRICT`,

  `ALTER TABLE prepaid_schedules DROP CONSTRAINT IF EXISTS fk_ps_expense`,
  `ALTER TABLE prepaid_schedules ADD CONSTRAINT fk_ps_expense
     FOREIGN KEY (expense_account_id) REFERENCES accounting_accounts(id) ON DELETE RESTRICT`,

  /*
   * مرجعٌ واحد نشط لكل كيان — العقد لا يُجدوَل مرّتين.
   *
   * وبلا هذا يمرّ تحميلٌ مكرّر للكشف فيُطفأ كل شيء ضِعفين، ولا يظهر الخلل إلا
   * حين يهبط الحساب تحت الصفر بعد أشهر.
   */
  `CREATE UNIQUE INDEX IF NOT EXISTS uq_ps_active_reference
     ON prepaid_schedules (legal_entity_id, source_reference) WHERE is_active`,

  `CREATE INDEX IF NOT EXISTS ix_ps_entity_active
     ON prepaid_schedules (legal_entity_id) WHERE is_active`,

  `ALTER TABLE prepaid_schedules ENABLE ROW LEVEL SECURITY`,

  /*
   * الحماية بـREVOKE لا بـRLS وحده.
   *
   * `TRUNCATE` يتجاوز مشغّلات الصفوف ولا يحكمه RLS — مُثبَت معملياً على هذا
   * المستودع. فالسحب صريح من الدورين المكشوفين عبر Supabase Data API.
   */
  `DO $rev$
   DECLARE r text;
   BEGIN
     FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
       IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
         EXECUTE format('REVOKE ALL ON TABLE prepaid_schedules FROM %I', r);
       END IF;
     END LOOP;
   END $rev$;`,
];

export const PREPAID_SCHEDULE_DOWN: string[] = [
  `DROP TABLE IF EXISTS prepaid_schedules`,
];
