/**
 * ═══════════════════════════════════════════════════════════════════════════
 * P1.1A — أسماء كائنات المخطط المحاسبي
 *
 * كل اسم قيد هنا **ثابت مُصدَّر** يشترك فيه SQL الهجرة والكيان معاً.
 * TypeORM يوفّق القيود والمفاتيح والفهارس **بالاسم**، ويُسقِط ما لا يجده في
 * البيانات الوصفية عند أي مزامنة. إغفال ذلك محا ضمانات نزاهة كاملة من قبل
 * (حادثة R3A.1) — فالتطابق شرط بقاء لا تنظيم.
 * ═══════════════════════════════════════════════════════════════════════════
 */

// ── القيم المسموحة ──────────────────────────────────────────────────────────
export const ACCOUNT_TYPES = ['asset', 'liability', 'equity', 'revenue', 'expense'] as const;
export const NORMAL_BALANCES = ['debit', 'credit'] as const;
export const PERIOD_STATUSES = ['open', 'soft_closed', 'hard_closed'] as const;
export const ENTRY_STATUSES = ['draft', 'posted', 'reversed', 'void'] as const;

/**
 * نوع الحدث المحاسبي — لا يُخلط مع مصدره.
 * المصدر الواحد (فاتورة) يولّد أحداثاً مشروعة مختلفة: استحقاق ثم تسوية ثم عكس.
 * لذلك مفتاح منع الازدواج يضمّ نوع الحدث، وإلا مَنَع عمليات صحيحة.
 */
export const ACCOUNTING_EVENT_TYPES = [
  'manual', 'opening_balance', 'invoice_accrual', 'payment_settlement',
  'reversal', 'adjustment', 'depreciation', 'fx_revaluation',
] as const;

export const FX_SOURCES = ['FUNCTIONAL', 'ECB', 'BANK', 'MANUAL_APPROVED', 'OTHER_APPROVED'] as const;

export type AccountType = (typeof ACCOUNT_TYPES)[number];
export type PeriodStatus = (typeof PERIOD_STATUSES)[number];
export type EntryStatus = (typeof ENTRY_STATUSES)[number];
export type AccountingEventType = (typeof ACCOUNTING_EVENT_TYPES)[number];

/** تفاوت نقدي — أصغر من نصف سنت فلا يخلق فروقاً وهمية ولا يبتلع فرقاً حقيقياً. */
export const MONEY_TOL = 0.005;

/**
 * ── الشاشات المحاسبية ──
 * الفصل بين الواجبات مبنيّ على **حبيبة الشاشة** لا على دور جديد: توسيع الأدوار
 * العامة (admin/user) كان سيمسّ تفويض R2 كلّه. مُعِدّ القيد يملك `journals`،
 * والمُرحِّل يملك `posting`، ولا يلزم أن يملك أحدهما الآخر.
 *
 * ⚠️ إفصاح صريح: الأدمن يتجاوز كل الشاشات بحكم `ScreenAuthzService` — فالفصل
 * قائم بين المستخدمين لا في مواجهة الأدمن. هذا قيد معلوم لا ثغرة مخفيّة.
 */
export const SCREEN_ACCOUNTING = '/dashboard/accounting';
export const SCREEN_ACCOUNTING_JOURNALS = '/dashboard/accounting/journals';
export const SCREEN_ACCOUNTING_POSTING = '/dashboard/accounting/posting';
export const SCREEN_ACCOUNTING_PERIODS = '/dashboard/accounting/periods';
export const SCREEN_ACCOUNTING_SETUP = '/dashboard/accounting/setup';
export const SCREEN_ACCOUNTING_REPORTS = '/dashboard/accounting/reports';

const list = (a: readonly string[]) => a.map((x) => `'${x}'`).join(',');

// ── أسماء القيود ────────────────────────────────────────────────────────────
export const CHK_ACCT_TYPE = 'chk_acct_type';
export const CHK_ACCT_TYPE_EXPR = `account_type IN (${list(ACCOUNT_TYPES)})`;

export const CHK_ACCT_NORMAL = 'chk_acct_normal_balance';
export const CHK_ACCT_NORMAL_EXPR = `normal_balance IN (${list(NORMAL_BALANCES)})`;

export const CHK_PERIOD_STATUS = 'chk_period_status';
export const CHK_PERIOD_STATUS_EXPR = `status IN (${list(PERIOD_STATUSES)})`;

export const CHK_PERIOD_NO = 'chk_period_no';
export const CHK_PERIOD_NO_EXPR = 'period_no BETWEEN 0 AND 12';

export const CHK_PERIOD_DATES = 'chk_period_dates';
export const CHK_PERIOD_DATES_EXPR = 'end_date >= start_date';

export const CHK_JE_STATUS = 'chk_je_status';
export const CHK_JE_STATUS_EXPR = `status IN (${list(ENTRY_STATUSES)})`;

export const CHK_JE_EVENT_TYPE = 'chk_je_event_type';
export const CHK_JE_EVENT_TYPE_EXPR = `accounting_event_type IN (${list(ACCOUNTING_EVENT_TYPES)})`;

/** القيد المُرحَّل يحمل رقماً رسمياً — المسوّدة لا. */
export const CHK_JE_POSTED_HAS_NO = 'chk_je_posted_has_no';
export const CHK_JE_POSTED_HAS_NO_EXPR = "status <> 'posted' OR entry_no IS NOT NULL";

/** التوازن يُفرض في القاعدة لا في التطبيق وحده. */
export const CHK_JE_POSTED_BALANCED = 'chk_je_posted_balanced';
export const CHK_JE_POSTED_BALANCED_EXPR =
  "status <> 'posted' OR total_debit_eur = total_credit_eur";

export const CHK_JE_BACKDATE_REASON = 'chk_je_backdate_reason';
export const CHK_JE_BACKDATE_REASON_EXPR =
  'is_backdated = false OR backdated_reason IS NOT NULL';

export const CHK_JL_NONNEG = 'chk_jl_nonneg';
export const CHK_JL_NONNEG_EXPR =
  'debit >= 0 AND credit >= 0 AND debit_eur >= 0 AND credit_eur >= 0';

/** السطر مدين أو دائن — لا الاثنان ولا لا شيء. */
export const CHK_JL_ONE_SIDE = 'chk_jl_one_side';
export const CHK_JL_ONE_SIDE_EXPR = '(debit > 0) <> (credit > 0)';

/** جانب اليورو يطابق جانب المعاملة — يمنع انقلاب الإشارة عند التحويل. */
export const CHK_JL_EUR_SIDE = 'chk_jl_eur_side';
export const CHK_JL_EUR_SIDE_EXPR = '(debit_eur > 0) = (debit > 0)';

export const CHK_JL_FX_POSITIVE = 'chk_jl_fx_positive';
export const CHK_JL_FX_POSITIVE_EXPR = 'fx_rate > 0';

/** اليورو هو العملة الوظيفية ⇒ سعره واحد دائماً، بلا استثناء. */
export const CHK_JL_EUR_RATE_ONE = 'chk_jl_eur_rate_is_one';
export const CHK_JL_EUR_RATE_ONE_EXPR = "transaction_currency <> 'EUR' OR fx_rate = 1";

export const CHK_JL_FX_SOURCE = 'chk_jl_fx_source';
export const CHK_JL_FX_SOURCE_EXPR = `fx_source IN (${list(FX_SOURCES)})`;

/**
 * تكافؤ لا اشتراط أحادي: العملة يورو **إذا وفقط إذا** كان المصدر FUNCTIONAL.
 * الصيغة الأحادية القديمة كانت تسمح لسطر باليورو أن يدّعي مصدراً خارجياً —
 * وهو ادّعاء بلا معنى: لا يُصرَف اليورو إلى اليورو.
 */
export const CHK_JL_FOREIGN_NEEDS_FX = 'chk_jl_foreign_needs_fx';
export const CHK_JL_FOREIGN_NEEDS_FX_EXPR =
  "(transaction_currency = 'EUR') = (fx_source = 'FUNCTIONAL')";

export const CHK_FX_RATE_POSITIVE = 'chk_fx_rate_positive';
export const CHK_FX_RATE_POSITIVE_EXPR = 'rate > 0';

export const CHK_FX_SOURCE = 'chk_fx_source';
export const CHK_FX_SOURCE_EXPR = `source IN (${list(FX_SOURCES.filter((s) => s !== 'FUNCTIONAL'))})`;

export const CHK_FX_MANUAL_APPROVED = 'chk_fx_manual_approved';
export const CHK_FX_MANUAL_APPROVED_EXPR =
  "source <> 'MANUAL_APPROVED' OR approved_by IS NOT NULL";

// ── أسماء المفاتيح الخارجية ─────────────────────────────────────────────────
export const FK_ACCT_ENTITY = 'fk_acct_legal_entity';
export const FK_ACCT_PARENT = 'fk_acct_parent';
export const FK_JOURNAL_ENTITY = 'fk_journal_legal_entity';
export const FK_FY_ENTITY = 'fk_fy_legal_entity';
export const FK_PERIOD_ENTITY = 'fk_period_legal_entity';
export const FK_PERIOD_FY = 'fk_period_fiscal_year';
export const FK_JE_ENTITY = 'fk_je_legal_entity';
export const FK_JE_JOURNAL = 'fk_je_journal';
export const FK_JE_FY = 'fk_je_fiscal_year';
export const FK_JE_PERIOD = 'fk_je_period';
export const FK_JE_REVERSAL_OF = 'fk_je_reversal_of';
export const FK_JE_REVERSED_BY = 'fk_je_reversed_by';
export const FK_JL_ENTRY = 'fk_jl_entry';
export const FK_JL_ACCOUNT = 'fk_jl_account';
export const FK_JL_FX_RATE = 'fk_jl_fx_rate';
export const FK_JL_COST_CENTER = 'fk_jl_cost_center';
export const FK_CC_ENTITY = 'fk_cc_legal_entity';
export const FK_FX_ENTITY = 'fk_fx_legal_entity';

// ── أسماء الفهارس ───────────────────────────────────────────────────────────
export const UQ_ENTITY_CODE = 'uq_legal_entity_code';
export const UQ_ACCT_CODE = 'uq_acct_entity_code';
export const UQ_ACCT_ROLE = 'uq_acct_entity_system_role';
export const UQ_JOURNAL_CODE = 'uq_journal_entity_code';
export const UQ_FY = 'uq_fy_entity_year';
export const UQ_PERIOD = 'uq_period_fy_no';
export const UQ_JE_ENTRY_NO = 'uq_je_entity_fy_entry_no';
export const UQ_JE_EVENT = 'uq_je_accounting_event';
export const UQ_JL_LINE = 'uq_jl_entry_line';
export const UQ_FX_RATE = 'uq_fx_rate_lookup';
export const UQ_CC_CODE = 'uq_cc_entity_code';

export const IDX_JL_ACCOUNT = 'idx_jl_account';
export const IDX_JE_PERIOD = 'idx_je_period_status';
export const IDX_JE_SOURCE = 'idx_je_source';
export const IDX_JE_BACKDATED = 'idx_je_backdated';
export const IDX_JL_VESSEL = 'idx_jl_vessel';
export const IDX_JL_SUPPLIER = 'idx_jl_supplier';
export const IDX_FX_LOOKUP = 'idx_fx_lookup';
