/**
 * ═══════════════════════════════════════════════════════════════════════════
 * P1.1A — ACCOUNTING FOUNDATION · هجرة صريحة
 *
 * تسعة جداول جديدة. **صفر ALTER على أي جدول أعمال قائم · صفر UPDATE · صفر backfill.**
 * Postgres يدعم DDL معامَلاتياً ⇒ كل شيء داخل BEGIN/COMMIT: نجاح كامل أو تراجع كامل.
 * متكرّرة الأمان: التشغيل الثاني لا يُنشئ ولا يُعدّل شيئاً.
 *
 * أسماء القيود والفهارس من accounting.constants حصراً — الكيانات تُعلن الأسماء نفسها،
 * وإلا أسقطها synchronize عند أي مزامنة مستقبلية.
 * ═══════════════════════════════════════════════════════════════════════════
 */
import * as C from '../modules/accounting/accounting.constants';

/** يلفّ إضافة قيد بحيث لا تفشل عند إعادة التشغيل. */
const addConstraint = (table: string, name: string, definition: string) => `
DO $$ BEGIN
  ALTER TABLE ${table} ADD CONSTRAINT ${name} ${definition};
EXCEPTION WHEN duplicate_object THEN NULL; END $$`;

const check = (table: string, name: string, expr: string) =>
  addConstraint(table, name, `CHECK (${expr})`);

const fk = (table: string, name: string, cols: string, ref: string, onDelete = 'RESTRICT') =>
  addConstraint(table, name, `FOREIGN KEY (${cols}) REFERENCES ${ref} ON DELETE ${onDelete}`);

// ── الجداول ─────────────────────────────────────────────────────────────────
const TABLES = [
  `CREATE TABLE IF NOT EXISTS legal_entities (
     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     code VARCHAR(20) NOT NULL,
     name VARCHAR(200) NOT NULL,
     name_ar VARCHAR(200),
     functional_currency VARCHAR(3) NOT NULL,
     fiscal_year_start_month SMALLINT NOT NULL DEFAULT 1,
     accounting_start_date DATE NOT NULL,
     is_active BOOLEAN NOT NULL DEFAULT true,
     created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
     updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,

  `CREATE TABLE IF NOT EXISTS cost_centers (
     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     legal_entity_id UUID NOT NULL,
     code VARCHAR(20) NOT NULL,
     name VARCHAR(200) NOT NULL,
     is_active BOOLEAN NOT NULL DEFAULT true,
     created_at TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,

  // account_type · account_group · system_role ثلاثة مفاهيم منفصلة عمداً.
  // لا منطق أعمال يقرأ code — المنطق يطلب system_role.
  `CREATE TABLE IF NOT EXISTS accounting_accounts (
     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     legal_entity_id UUID NOT NULL,
     code VARCHAR(20) NOT NULL,
     name VARCHAR(200) NOT NULL,
     name_ar VARCHAR(200),
     account_type VARCHAR(20) NOT NULL,
     account_group VARCHAR(60),
     system_role VARCHAR(40),
     normal_balance VARCHAR(6) NOT NULL,
     parent_id UUID,
     level SMALLINT NOT NULL DEFAULT 1,
     is_postable BOOLEAN NOT NULL DEFAULT true,
     is_monetary BOOLEAN NOT NULL DEFAULT false,
     is_related_party BOOLEAN NOT NULL DEFAULT false,
     requires_subledger BOOLEAN NOT NULL DEFAULT false,
     currency_restriction VARCHAR(3),
     is_active BOOLEAN NOT NULL DEFAULT true,
     created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
     updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,

  `CREATE TABLE IF NOT EXISTS journals (
     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     legal_entity_id UUID NOT NULL,
     code VARCHAR(10) NOT NULL,
     name VARCHAR(100) NOT NULL,
     entry_prefix VARCHAR(10) NOT NULL,
     is_active BOOLEAN NOT NULL DEFAULT true,
     created_at TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,

  // next_entry_no عدّاد الترقيم: يُقفل صفّه أثناء الترحيل فلا فجوات ولا تكرار.
  `CREATE TABLE IF NOT EXISTS fiscal_years (
     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     legal_entity_id UUID NOT NULL,
     year SMALLINT NOT NULL,
     start_date DATE NOT NULL,
     end_date DATE NOT NULL,
     status VARCHAR(15) NOT NULL DEFAULT 'open',
     next_entry_no INTEGER NOT NULL DEFAULT 1,
     created_at TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,

  // period_no = 0 هي الفترة الافتتاحية (31/12/2025) — تفصل الرصيد الافتتاحي عن يناير.
  `CREATE TABLE IF NOT EXISTS fiscal_periods (
     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     legal_entity_id UUID NOT NULL,
     fiscal_year_id UUID NOT NULL,
     period_no SMALLINT NOT NULL,
     name VARCHAR(30) NOT NULL,
     start_date DATE NOT NULL,
     end_date DATE NOT NULL,
     status VARCHAR(15) NOT NULL DEFAULT 'open',
     closed_by UUID, closed_at TIMESTAMPTZ, close_reason VARCHAR(500),
     reopened_by UUID, reopened_at TIMESTAMPTZ, reopen_reason VARCHAR(500),
     created_at TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,

  // مستقلّ تماماً عن exchange_rates القائم: ذاك مربوط بالدولار وبلا أثر تدقيق.
  `CREATE TABLE IF NOT EXISTS accounting_fx_rates (
     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     legal_entity_id UUID NOT NULL,
     currency_from VARCHAR(3) NOT NULL,
     currency_to VARCHAR(3) NOT NULL,
     rate NUMERIC(18,8) NOT NULL,
     rate_date DATE NOT NULL,
     source VARCHAR(20) NOT NULL,
     source_reference VARCHAR(200),
     created_by UUID, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
     approved_by UUID, approved_at TIMESTAMPTZ
   )`,

  // ثلاثة تواريخ لا تختلط: متى حدثت · أي فترة تخص · متى أُدخلت.
  `CREATE TABLE IF NOT EXISTS journal_entries (
     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     legal_entity_id UUID NOT NULL,
     journal_id UUID NOT NULL,
     fiscal_year_id UUID NOT NULL,
     fiscal_period_id UUID NOT NULL,
     entry_no VARCHAR(30),
     status VARCHAR(15) NOT NULL DEFAULT 'draft',
     accounting_event_type VARCHAR(30) NOT NULL DEFAULT 'manual',
     source_document_date DATE NOT NULL,
     accounting_date DATE NOT NULL,
     description VARCHAR(500) NOT NULL,
     reference VARCHAR(200),
     source_type VARCHAR(30),
     source_id UUID,
     source_reference VARCHAR(200),
     is_backdated BOOLEAN NOT NULL DEFAULT false,
     backdated_reason VARCHAR(500),
     reversal_of_entry_id UUID,
     reversed_by_entry_id UUID,
     total_debit_eur NUMERIC(18,2) NOT NULL DEFAULT 0,
     total_credit_eur NUMERIC(18,2) NOT NULL DEFAULT 0,
     created_by UUID, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
     reviewed_by UUID, reviewed_at TIMESTAMPTZ,
     posted_by UUID, posted_at TIMESTAMPTZ,
     updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,

  // كل سطر يحمل قيمته الأصلية ودليل تحويلها معاً — لا تحويل ضمني أبداً.
  `CREATE TABLE IF NOT EXISTS journal_lines (
     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     entry_id UUID NOT NULL,
     line_no SMALLINT NOT NULL,
     account_id UUID NOT NULL,
     debit NUMERIC(18,2) NOT NULL DEFAULT 0,
     credit NUMERIC(18,2) NOT NULL DEFAULT 0,
     transaction_currency VARCHAR(3) NOT NULL,
     fx_rate NUMERIC(18,8) NOT NULL DEFAULT 1,
     fx_date DATE NOT NULL,
     fx_source VARCHAR(20) NOT NULL,
     fx_rate_id UUID,
     debit_eur NUMERIC(18,2) NOT NULL DEFAULT 0,
     credit_eur NUMERIC(18,2) NOT NULL DEFAULT 0,
     vessel_id UUID,
     supplier_id UUID,
     customer_id UUID,
     cost_center_id UUID,
     description VARCHAR(500),
     created_at TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,
];

const CONSTRAINTS = [
  check('accounting_accounts', C.CHK_ACCT_TYPE, C.CHK_ACCT_TYPE_EXPR),
  check('accounting_accounts', C.CHK_ACCT_NORMAL, C.CHK_ACCT_NORMAL_EXPR),
  check('fiscal_periods', C.CHK_PERIOD_STATUS, C.CHK_PERIOD_STATUS_EXPR),
  check('fiscal_periods', C.CHK_PERIOD_NO, C.CHK_PERIOD_NO_EXPR),
  check('fiscal_periods', C.CHK_PERIOD_DATES, C.CHK_PERIOD_DATES_EXPR),
  check('journal_entries', C.CHK_JE_STATUS, C.CHK_JE_STATUS_EXPR),
  check('journal_entries', C.CHK_JE_EVENT_TYPE, C.CHK_JE_EVENT_TYPE_EXPR),
  check('journal_entries', C.CHK_JE_POSTED_HAS_NO, C.CHK_JE_POSTED_HAS_NO_EXPR),
  check('journal_entries', C.CHK_JE_POSTED_BALANCED, C.CHK_JE_POSTED_BALANCED_EXPR),
  check('journal_entries', C.CHK_JE_BACKDATE_REASON, C.CHK_JE_BACKDATE_REASON_EXPR),
  check('journal_lines', C.CHK_JL_NONNEG, C.CHK_JL_NONNEG_EXPR),
  check('journal_lines', C.CHK_JL_ONE_SIDE, C.CHK_JL_ONE_SIDE_EXPR),
  check('journal_lines', C.CHK_JL_EUR_SIDE, C.CHK_JL_EUR_SIDE_EXPR),
  check('journal_lines', C.CHK_JL_FX_POSITIVE, C.CHK_JL_FX_POSITIVE_EXPR),
  check('journal_lines', C.CHK_JL_EUR_RATE_ONE, C.CHK_JL_EUR_RATE_ONE_EXPR),
  check('journal_lines', C.CHK_JL_FX_SOURCE, C.CHK_JL_FX_SOURCE_EXPR),
  check('journal_lines', C.CHK_JL_FOREIGN_NEEDS_FX, C.CHK_JL_FOREIGN_NEEDS_FX_EXPR),
  check('accounting_fx_rates', C.CHK_FX_RATE_POSITIVE, C.CHK_FX_RATE_POSITIVE_EXPR),
  check('accounting_fx_rates', C.CHK_FX_SOURCE, C.CHK_FX_SOURCE_EXPR),
  check('accounting_fx_rates', C.CHK_FX_MANUAL_APPROVED, C.CHK_FX_MANUAL_APPROVED_EXPR),

  fk('cost_centers', C.FK_CC_ENTITY, 'legal_entity_id', 'legal_entities(id)'),
  fk('accounting_accounts', C.FK_ACCT_ENTITY, 'legal_entity_id', 'legal_entities(id)'),
  fk('accounting_accounts', C.FK_ACCT_PARENT, 'parent_id', 'accounting_accounts(id)'),
  fk('journals', C.FK_JOURNAL_ENTITY, 'legal_entity_id', 'legal_entities(id)'),
  fk('fiscal_years', C.FK_FY_ENTITY, 'legal_entity_id', 'legal_entities(id)'),
  fk('fiscal_periods', C.FK_PERIOD_ENTITY, 'legal_entity_id', 'legal_entities(id)'),
  fk('fiscal_periods', C.FK_PERIOD_FY, 'fiscal_year_id', 'fiscal_years(id)'),
  fk('accounting_fx_rates', C.FK_FX_ENTITY, 'legal_entity_id', 'legal_entities(id)'),
  fk('journal_entries', C.FK_JE_ENTITY, 'legal_entity_id', 'legal_entities(id)'),
  fk('journal_entries', C.FK_JE_JOURNAL, 'journal_id', 'journals(id)'),
  fk('journal_entries', C.FK_JE_FY, 'fiscal_year_id', 'fiscal_years(id)'),
  fk('journal_entries', C.FK_JE_PERIOD, 'fiscal_period_id', 'fiscal_periods(id)'),
  fk('journal_entries', C.FK_JE_REVERSAL_OF, 'reversal_of_entry_id', 'journal_entries(id)'),
  fk('journal_entries', C.FK_JE_REVERSED_BY, 'reversed_by_entry_id', 'journal_entries(id)'),
  // أسطر القيد جزء منه لا كيان مستقل — تُحذف معه عند حذف مسوّدة.
  fk('journal_lines', C.FK_JL_ENTRY, 'entry_id', 'journal_entries(id)', 'CASCADE'),
  fk('journal_lines', C.FK_JL_ACCOUNT, 'account_id', 'accounting_accounts(id)'),
  fk('journal_lines', C.FK_JL_FX_RATE, 'fx_rate_id', 'accounting_fx_rates(id)'),
  fk('journal_lines', C.FK_JL_COST_CENTER, 'cost_center_id', 'cost_centers(id)'),
];

const INDEXES = [
  `CREATE UNIQUE INDEX IF NOT EXISTS ${C.UQ_ENTITY_CODE} ON legal_entities (code)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS ${C.UQ_ACCT_CODE} ON accounting_accounts (legal_entity_id, code)`,
  // دور واحد لكل كيان — يمنع غموض "أي حساب هو حساب الذمم الدائنة؟"
  `CREATE UNIQUE INDEX IF NOT EXISTS ${C.UQ_ACCT_ROLE} ON accounting_accounts (legal_entity_id, system_role) WHERE system_role IS NOT NULL`,
  `CREATE UNIQUE INDEX IF NOT EXISTS ${C.UQ_JOURNAL_CODE} ON journals (legal_entity_id, code)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS ${C.UQ_FY} ON fiscal_years (legal_entity_id, year)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS ${C.UQ_PERIOD} ON fiscal_periods (fiscal_year_id, period_no)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS ${C.UQ_JE_ENTRY_NO} ON journal_entries (legal_entity_id, fiscal_year_id, entry_no) WHERE entry_no IS NOT NULL`,
  // ── منع الحدث المحاسبي المكرَّر ──
  // نوع الحدث جزء من المفتاح: الفاتورة الواحدة تولّد استحقاقاً ثم تسوية ثم عكساً،
  // وكلها مشروعة. المفتاح بلا نوع الحدث كان سيمنع عمليات صحيحة.
  `CREATE UNIQUE INDEX IF NOT EXISTS ${C.UQ_JE_EVENT} ON journal_entries (legal_entity_id, accounting_event_type, source_type, source_id) WHERE source_id IS NOT NULL AND status <> 'void'`,
  `CREATE UNIQUE INDEX IF NOT EXISTS ${C.UQ_JL_LINE} ON journal_lines (entry_id, line_no)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS ${C.UQ_FX_RATE} ON accounting_fx_rates (legal_entity_id, currency_from, currency_to, rate_date, source)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS ${C.UQ_CC_CODE} ON cost_centers (legal_entity_id, code)`,

  `CREATE INDEX IF NOT EXISTS ${C.IDX_JL_ACCOUNT} ON journal_lines (account_id, entry_id)`,
  `CREATE INDEX IF NOT EXISTS ${C.IDX_JE_PERIOD} ON journal_entries (legal_entity_id, fiscal_period_id, status)`,
  `CREATE INDEX IF NOT EXISTS ${C.IDX_JE_SOURCE} ON journal_entries (source_type, source_id) WHERE source_id IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS ${C.IDX_JE_BACKDATED} ON journal_entries (legal_entity_id, is_backdated) WHERE is_backdated`,
  `CREATE INDEX IF NOT EXISTS ${C.IDX_JL_VESSEL} ON journal_lines (vessel_id) WHERE vessel_id IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS ${C.IDX_JL_SUPPLIER} ON journal_lines (supplier_id) WHERE supplier_id IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS ${C.IDX_FX_LOOKUP} ON accounting_fx_rates (legal_entity_id, currency_from, rate_date DESC)`,
];

/**
 * ── ثبات القيد المُرحَّل ──
 * الحماية في المحرّك لا في التطبيق: لا يمكن الالتفاف عليها من أي مسار،
 * ولا من اتصال مباشر بقاعدة البيانات.
 */
const TRIGGERS = [
  /**
   * ثبات رأس القيد.
   *
   * المقارنة على **الصف كاملاً** كـjsonb لا على قائمة أعمدة محدَّدة: قائمة الأعمدة
   * تحمي ما فكّرتُ فيه اليوم وتترك كل عمود يُضاف غداً مكشوفاً بلا أن ينبّه أحد.
   * مقارنة الصف كله تعكس القاعدة: **كل شيء ممنوع إلا الاستثناء المُعلَن**.
   *
   * الاستثناء الوحيد: توسيم القيد الأصلي بأنه عُكِس — انتقال `posted → reversed`
   * مصحوباً بمعرّف القيد العاكس، وبشرط ألا يتغيّر أي حقل آخر.
   */
  `CREATE OR REPLACE FUNCTION accounting_je_immutable() RETURNS TRIGGER AS $$
   BEGIN
     IF (TG_OP = 'DELETE') THEN
       IF OLD.status IN ('posted','reversed') THEN
         RAISE EXCEPTION 'لا يجوز حذف قيد مُرحَّل (%). التصحيح يكون بقيد عكسي.', OLD.entry_no;
       END IF;
       RETURN OLD;
     END IF;

     IF OLD.status IN ('posted','reversed') THEN
       IF OLD.status = 'posted' AND NEW.status = 'reversed'
          AND OLD.reversed_by_entry_id IS NULL
          AND NEW.reversed_by_entry_id IS NOT NULL
          AND (to_jsonb(NEW) - 'status' - 'reversed_by_entry_id' - 'updated_at')
            = (to_jsonb(OLD) - 'status' - 'reversed_by_entry_id' - 'updated_at')
       THEN
         RETURN NEW;
       END IF;
       RAISE EXCEPTION 'قيد مُرحَّل (%) لا يقبل أي تعديل عدا توسيمه بالعكس.', OLD.entry_no;
     END IF;

     RETURN NEW;
   END; $$ LANGUAGE plpgsql`,

  `DROP TRIGGER IF EXISTS trg_je_immutable ON journal_entries`,
  `CREATE TRIGGER trg_je_immutable BEFORE UPDATE OR DELETE ON journal_entries
     FOR EACH ROW EXECUTE FUNCTION accounting_je_immutable()`,

  // ⚠️ لا COALESCE على NEW/OLD: في INSERT يكون OLD غير مُسنَد، وقراءة حقل منه
  //    ترفع خطأ وقت التشغيل. التفريع على TG_OP هو الشكل الصحيح الوحيد هنا.
  `CREATE OR REPLACE FUNCTION accounting_jl_immutable() RETURNS TRIGGER AS $$
   DECLARE st VARCHAR(15); eid UUID;
   BEGIN
     IF (TG_OP = 'DELETE') THEN eid := OLD.entry_id; ELSE eid := NEW.entry_id; END IF;
     SELECT status INTO st FROM journal_entries WHERE id = eid;
     IF st IN ('posted','reversed') THEN
       RAISE EXCEPTION 'لا يجوز المساس بأسطر قيد مُرحَّل.';
     END IF;
     IF (TG_OP = 'DELETE') THEN RETURN OLD; ELSE RETURN NEW; END IF;
   END; $$ LANGUAGE plpgsql`,

  `DROP TRIGGER IF EXISTS trg_jl_immutable ON journal_lines`,
  `CREATE TRIGGER trg_jl_immutable BEFORE INSERT OR UPDATE OR DELETE ON journal_lines
     FOR EACH ROW EXECUTE FUNCTION accounting_jl_immutable()`,

  /**
   * ── التوازن الحقيقي · قيد مؤجَّل حتى COMMIT ──
   *
   * `chk_je_posted_balanced` يقارن عمودَي الرأس ببعضهما فقط — ولا يربطهما بمجموع
   * الأسطر إطلاقاً. رأسٌ متوازن فوق أسطر غير متوازنة كان يمرّ منه بلا اعتراض.
   *
   * الفحص **مؤجَّل** لأنه لا يمكن أن يكون فورياً: الأسطر تُكتب على دفعات، فالقيد
   * غير متوازن بالضرورة في لحظات وسيطة داخل المعاملة. التأجيل حتى COMMIT هو
   * الشكل الوحيد الذي يجعل الجملة "لا لحظة يُلتزَم فيها قيد مُرحَّل غير متوازن"
   * صحيحة حرفياً.
   *
   * يُعاد قراءة الصف من الجدول لا من NEW: ترتيب أحداث المعاملة قد يجعل NEW لقطة
   * قديمة، والقراءة الحيّة تجعل النتيجة مستقلة عن الترتيب.
   */
  `CREATE OR REPLACE FUNCTION accounting_je_assert_balanced() RETURNS TRIGGER AS $$
   DECLARE st VARCHAR(15); hd NUMERIC(18,2); hc NUMERIC(18,2);
           ld NUMERIC(18,2); lc NUMERIC(18,2); ln INT;
   BEGIN
     SELECT status, total_debit_eur, total_credit_eur INTO st, hd, hc
       FROM journal_entries WHERE id = NEW.id;
     IF NOT FOUND THEN RETURN NULL; END IF;
     IF st NOT IN ('posted','reversed') THEN RETURN NULL; END IF;

     SELECT COUNT(*), COALESCE(SUM(debit_eur),0), COALESCE(SUM(credit_eur),0)
       INTO ln, ld, lc FROM journal_lines WHERE entry_id = NEW.id;

     IF ln < 2 THEN
       RAISE EXCEPTION 'قيد مُرحَّل بأقل من سطرين (%).', NEW.entry_no;
     END IF;
     IF ld <> lc THEN
       RAISE EXCEPTION 'قيد مُرحَّل غير متوازن (%): مدين % · دائن %.', NEW.entry_no, ld, lc;
     END IF;
     IF ld <> hd OR lc <> hc THEN
       RAISE EXCEPTION 'إجماليات رأس القيد (%) لا تطابق مجموع أسطره: رأس %/% · أسطر %/%.',
         NEW.entry_no, hd, hc, ld, lc;
     END IF;
     RETURN NULL;
   END; $$ LANGUAGE plpgsql`,

  `DROP TRIGGER IF EXISTS trg_je_balanced_deferred ON journal_entries`,
  `CREATE CONSTRAINT TRIGGER trg_je_balanced_deferred
     AFTER INSERT OR UPDATE ON journal_entries
     DEFERRABLE INITIALLY DEFERRED
     FOR EACH ROW EXECUTE FUNCTION accounting_je_assert_balanced()`,

  /**
   * ── حارس الفترة على مستوى المحرّك ──
   *
   * حالة الفترة كانت محروسة في الخدمة وحدها، فأي مسار آخر — سكربت، اتصال مباشر،
   * وحدة مستقبلية — كان يرحّل في فترة مُقفلة بلا اعتراض. الإقفال الذي يُلتَفّ عليه
   * ليس إقفالاً.
   *
   * يفحص **عند الترحيل فقط** (`status = 'posted'`). توسيم الأصل بـ`reversed` لا
   * يُفحَص عمداً: عكس قيد في فترة مُقفلة هو تحديداً سبب وجود العكس، والقيد العاكس
   * نفسه يُفحَص لأنه يُرحَّل في فترته هو.
   */
  `CREATE OR REPLACE FUNCTION accounting_je_period_guard() RETURNS TRIGGER AS $$
   DECLARE ps VARCHAR(15);
   BEGIN
     IF NEW.status <> 'posted' THEN RETURN NEW; END IF;
     IF (TG_OP = 'UPDATE' AND OLD.status = 'posted') THEN RETURN NEW; END IF;

     SELECT status INTO ps FROM fiscal_periods WHERE id = NEW.fiscal_period_id;
     IF ps = 'hard_closed' THEN
       RAISE EXCEPTION 'الفترة مُقفلة نهائياً — لا ترحيل فيها. التصحيح بقيد في فترة لاحقة.';
     END IF;
     IF ps = 'soft_closed' AND NEW.accounting_event_type NOT IN ('adjustment','reversal') THEN
       RAISE EXCEPTION 'الفترة مُقفلة مبدئياً — لا يُقبل فيها إلا قيد تسوية أو عكس.';
     END IF;
     RETURN NEW;
   END; $$ LANGUAGE plpgsql`,

  `DROP TRIGGER IF EXISTS trg_je_period_guard ON journal_entries`,
  `CREATE TRIGGER trg_je_period_guard BEFORE INSERT OR UPDATE ON journal_entries
     FOR EACH ROW EXECUTE FUNCTION accounting_je_period_guard()`,
];

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * ── إغلاق باب الوصول المباشر ──
 *
 * الصلاحيات الافتراضية في Supabase تمنح دورَي `anon` و`authenticated` صلاحيات
 * كاملة على كل جدول يُنشأ في `public` — بما فيها `TRUNCATE`. والدوران يُستخدمان
 * بمفتاح عام مصمَّم للنشر.
 *
 * ⚠️ ولماذا هذا قاتل هنا تحديداً: **`TRUNCATE` لا يُشغِّل مشغّلات الصفوف إطلاقاً.**
 *    `trg_je_immutable` يحرس DELETE و UPDATE ولا يرى TRUNCATE أبداً — فأمر واحد
 *    كان يمحو دفتراً محاسبياً كاملاً بلا اعتراض. مُثبَت بالتجربة: قيد مُرحَّل
 *    رُفض حذفه بالمشغّل ثم مُحي بـTRUNCATE في نفس الجلسة.
 *
 * و**RLS وحده لا يكفي**: RLS لا يحكم TRUNCATE أصلاً. مُثبَت: مع تفعيل RLS وإعادة
 * الصلاحية، نجح `anon` في TRUNCATE. العلاج هو `REVOKE` — وRLS طبقة ثانية تحسّباً
 * لأي منح مستقبلي عريض (`GRANT ... ON ALL TABLES`).
 *
 * النطاق: **الجداول التسعة الجديدة وحدها**. لا يمسّ هذا أي جدول قائم — وضع
 * الجداول القائمة قرار مستقل بحجمه.
 *
 * `service_role` لا يُمسّ: مفتاح خادمي لا يُشحن للعملاء، وتُستخدمه لوحة Supabase.
 * ═══════════════════════════════════════════════════════════════════════════
 */
const ACCOUNTING_TABLES = [
  'legal_entities', 'cost_centers', 'accounting_accounts', 'journals',
  'fiscal_years', 'fiscal_periods', 'accounting_fx_rates',
  'journal_entries', 'journal_lines',
];

/**
 * السحب مشروط بوجود الدور: `anon` و`authenticated` دوران من صنع Supabase لا من
 * صنع Postgres. `REVOKE` من دور غير موجود **خطأ يُسقِط المعاملة كلها**، فكانت
 * الهجرة ستفشل على أي قاعدة بيانات خارج Supabase — بما فيها بيئة اختبار.
 * الشرط يجعلها تعمل في الحالتين، ولا يضعف شيئاً: غياب الدور = لا صلاحية تُسحب.
 */
const REVOKE_BLOCK = `
DO $$
DECLARE t text; r text;
BEGIN
  FOREACH t IN ARRAY ARRAY[${ACCOUNTING_TABLES.map((x) => `'${x}'`).join(',')}] LOOP
    FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
        EXECUTE format('REVOKE ALL ON %I FROM %I', t, r);
      END IF;
    END LOOP;
  END LOOP;
END $$`;

const GRANTS: string[] = [
  REVOKE_BLOCK,
  ...ACCOUNTING_TABLES.map((t) => `ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY`),
];

export const P11A_UP: string[] = [
  ...TABLES, ...CONSTRAINTS, ...INDEXES, ...TRIGGERS, ...GRANTS,
];

/** تراجع نظيف: كل الجداول جديدة ⇒ حالة PMS قبل P1.1A لا تتأثر بأي حال. */
export const P11A_DOWN: string[] = [
  `DROP TRIGGER IF EXISTS trg_je_period_guard ON journal_entries`,
  `DROP TRIGGER IF EXISTS trg_je_balanced_deferred ON journal_entries`,
  `DROP TRIGGER IF EXISTS trg_jl_immutable ON journal_lines`,
  `DROP TRIGGER IF EXISTS trg_je_immutable ON journal_entries`,
  `DROP FUNCTION IF EXISTS accounting_je_period_guard()`,
  `DROP FUNCTION IF EXISTS accounting_je_assert_balanced()`,
  `DROP FUNCTION IF EXISTS accounting_jl_immutable()`,
  `DROP FUNCTION IF EXISTS accounting_je_immutable()`,
  `DROP TABLE IF EXISTS journal_lines`,
  `DROP TABLE IF EXISTS journal_entries`,
  `DROP TABLE IF EXISTS accounting_fx_rates`,
  `DROP TABLE IF EXISTS fiscal_periods`,
  `DROP TABLE IF EXISTS fiscal_years`,
  `DROP TABLE IF EXISTS journals`,
  `DROP TABLE IF EXISTS accounting_accounts`,
  `DROP TABLE IF EXISTS cost_centers`,
  `DROP TABLE IF EXISTS legal_entities`,
];

/** يُطبع كسكربت واحد للمراجعة والتنفيذ اليدوي في محرّر SQL. */
export function renderSql(statements: string[], label: string): string {
  return `-- ═══ ${label} ═══\nBEGIN;\n\n` +
    statements.map((s) => s.trim().replace(/;\s*$/, '') + ';').join('\n\n') +
    `\n\nCOMMIT;\n`;
}
