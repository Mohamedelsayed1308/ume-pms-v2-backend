import { BadRequestException, ConflictException, UnprocessableEntityException } from '@nestjs/common';
import { MONEY_TOL } from './accounting.constants';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * P1.1A — محرّك الترحيل · منطق خالص
 *
 * كل قاعدة محاسبية هنا **دالّة خالصة**: لا قاعدة بيانات ولا وقت نظام ولا حالة.
 * السبب ليس أناقة التصميم — بل أن قواعد المحاسبة يجب أن تكون قابلة للإثبات
 * باختبار، وأي قاعدة مدفونة داخل استعلام لا تُختبَر إلا بقاعدة بيانات حيّة،
 * فتبقى بلا إثبات. `today` يُمرَّر دائماً ولا يُقرأ من الساعة هنا.
 *
 * ⚠️ هذه الطبقة تمنع. وقاعدة البيانات تمنع مرة ثانية بقيودها ومشغّلاتها.
 *    الازدواج مقصود: التطبيق قد يُلتَفّ عليه، المحرّك لا.
 * ═══════════════════════════════════════════════════════════════════════════
 */

/** تقريب نقدي إلى القرش. `EPSILON` يعالج انحراف الفاصلة العائمة في 1.005 وأمثالها. */
export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export const EUR = 'EUR';

// ── المدخلات ────────────────────────────────────────────────────────────────
export interface LineInput {
  account_id: string;
  debit?: number | string | null;
  credit?: number | string | null;
  transaction_currency: string;
  fx_rate_id?: string | null;
  vessel_id?: string | null;
  supplier_id?: string | null;
  customer_id?: string | null;
  cost_center_id?: string | null;
  description?: string | null;
}

export interface AccountRef {
  id: string;
  legal_entity_id: string;
  is_active: boolean;
  is_postable: boolean;
  currency_restriction: string | null;
  account_type?: string;
  code?: string;
  name?: string;
}

export interface FxRateRef {
  id: string;
  legal_entity_id: string;
  currency_from: string;
  currency_to: string;
  rate: number | string;
  rate_date: string;
  source: string;
  created_by: string | null;
  approved_by: string | null;
  approved_at: Date | string | null;
}

export interface PeriodRef {
  id: string;
  legal_entity_id: string;
  fiscal_year_id: string;
  period_no: number;
  name?: string;
  start_date: string;
  end_date: string;
  status: string;
}

export interface PrepareContext {
  legal_entity_id: string;
  functional_currency: string;
  accounting_date: string;
  accounts: Map<string, AccountRef>;
  fxRates: Map<string, FxRateRef>;
}

export interface PreparedLine {
  line_no: number;
  account_id: string;
  debit: number;
  credit: number;
  transaction_currency: string;
  fx_rate: number;
  fx_date: string;
  fx_source: string;
  fx_rate_id: string | null;
  debit_eur: number;
  credit_eur: number;
  vessel_id: string | null;
  supplier_id: string | null;
  customer_id: string | null;
  cost_center_id: string | null;
  description: string | null;
}

export interface PreparedEntry {
  lines: PreparedLine[];
  total_debit_eur: number;
  total_credit_eur: number;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const CCY = /^[A-Z]{3}$/;

function num(v: number | string | null | undefined): number {
  if (v === null || v === undefined || v === '') return 0;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : NaN;
}

export function assertIsoDate(value: string, field: string): void {
  if (typeof value !== 'string' || !ISO_DATE.test(value)) {
    throw new BadRequestException(`${field}: التاريخ مطلوب بصيغة YYYY-MM-DD`);
  }
}

// ── تحضير الأسطر ────────────────────────────────────────────────────────────
/**
 * يحوّل مدخلات المستخدم إلى أسطر جاهزة للحفظ، **ويرفض** كل ما لا يمكن إثباته.
 *
 * المبدأ الحاكم: لا سطر بعملة أجنبية بلا سعر صرف **مُسجَّل ومعتمَد** يشير إليه
 * `fx_rate_id`. السعر يُنسَخ من الصف المعتمد لا من مدخلات الطلب — فلا يستطيع
 * أحد تمرير سعر يناسبه ثم إسناده لمصدر لا يقوله.
 */
export function prepareLines(inputs: LineInput[], ctx: PrepareContext): PreparedEntry {
  if (!Array.isArray(inputs) || inputs.length < 2) {
    throw new BadRequestException('القيد يحتاج سطرين على الأقل');
  }
  assertIsoDate(ctx.accounting_date, 'accounting_date');
  if (ctx.functional_currency !== EUR) {
    throw new UnprocessableEntityException(
      `العملة الوظيفية المدعومة في P1.1A هي EUR فقط — الكيان مُعرَّف بـ${ctx.functional_currency}`,
    );
  }

  const lines: PreparedLine[] = [];
  let td = 0;
  let tc = 0;

  inputs.forEach((raw, i) => {
    const at = `السطر ${i + 1}`;
    const debit = round2(num(raw.debit));
    const credit = round2(num(raw.credit));

    if (Number.isNaN(debit) || Number.isNaN(credit)) {
      throw new BadRequestException(`${at}: قيمة غير رقمية`);
    }
    if (debit < 0 || credit < 0) {
      throw new BadRequestException(`${at}: لا تُقبل قيمة سالبة — الاتجاه يُعبَّر عنه بالمدين أو الدائن`);
    }
    // مدين أو دائن — لا الاثنان ولا لا شيء. السطر الصفري ليس بريئاً: يخفي خطأ إدخال.
    if ((debit > 0) === (credit > 0)) {
      throw new BadRequestException(`${at}: السطر يجب أن يكون مديناً أو دائناً — لا الاثنين ولا صفراً`);
    }
    // فرق أصغر من القرش لا يُقبل صامتاً: يُرفض ليُصحَّح عند مصدره.
    if (round2(num(raw.debit)) !== num(raw.debit) || round2(num(raw.credit)) !== num(raw.credit)) {
      throw new BadRequestException(`${at}: المبلغ بكسور أقل من القرش — قرِّبه عند المصدر`);
    }

    const ccy = String(raw.transaction_currency || '').toUpperCase();
    if (!CCY.test(ccy)) throw new BadRequestException(`${at}: رمز عملة غير صالح`);

    const account = ctx.accounts.get(raw.account_id);
    if (!account) throw new BadRequestException(`${at}: الحساب غير موجود`);
    if (account.legal_entity_id !== ctx.legal_entity_id) {
      throw new UnprocessableEntityException(`${at}: الحساب يخصّ كياناً قانونياً آخر`);
    }
    if (!account.is_active) throw new UnprocessableEntityException(`${at}: الحساب غير نشط`);
    if (!account.is_postable) {
      throw new UnprocessableEntityException(`${at}: حساب تجميعي — الترحيل يكون على الحسابات الفرعية`);
    }
    if (account.currency_restriction && account.currency_restriction !== ccy) {
      throw new UnprocessableEntityException(
        `${at}: الحساب مقيَّد بعملة ${account.currency_restriction}`,
      );
    }

    let rate = 1;
    let fxDate = ctx.accounting_date;
    let fxSource = 'FUNCTIONAL';
    let fxRateId: string | null = null;

    if (ccy === EUR) {
      // العملة الوظيفية سعرها واحد — دائماً وبلا استثناء.
      if (raw.fx_rate_id) {
        throw new BadRequestException(`${at}: لا يُسنَد سعر صرف لسطر باليورو`);
      }
    } else {
      if (!raw.fx_rate_id) {
        throw new UnprocessableEntityException(
          `${at}: عملة أجنبية (${ccy}) بلا سعر صرف معتمَد — أضف السعر أولاً ثم أسنده`,
        );
      }
      const fx = ctx.fxRates.get(raw.fx_rate_id);
      if (!fx) throw new BadRequestException(`${at}: سعر الصرف المشار إليه غير موجود`);
      if (fx.legal_entity_id !== ctx.legal_entity_id) {
        throw new UnprocessableEntityException(`${at}: سعر الصرف يخصّ كياناً قانونياً آخر`);
      }
      if (fx.currency_from !== ccy || fx.currency_to !== EUR) {
        throw new UnprocessableEntityException(
          `${at}: سعر الصرف ${fx.currency_from}/${fx.currency_to} لا يطابق عملة السطر ${ccy}/EUR`,
        );
      }
      if (fx.source === 'FUNCTIONAL') {
        throw new UnprocessableEntityException(`${at}: مصدر FUNCTIONAL لا يصلح لعملة أجنبية`);
      }
      // الاعتماد شرط ترحيل لكل مصدر بلا استثناء. قصْره سابقاً على MANUAL_APPROVED
      // كان يجعل سعر ECB يُرحَّل به فور إنشائه — ومصدر السعر لا يُغني عن مراجعته.
      if (!fx.approved_by || !fx.approved_at) {
        throw new UnprocessableEntityException(
          `${at}: سعر صرف غير معتمَد (${fx.source}) — الاعتماد شرط الترحيل مهما كان المصدر`,
        );
      }
      // اشتراط معتمِدٍ ثانٍ أُسقط بقرار تشغيلي: مُدخِل البيانات واحد. والاعتماد
      // يبقى فعلاً منفصلاً مسجَّلاً — فالسعر لا يُرحَّل به لأنه أُدخِل بل لأنه خُتم.
      // سعر لاحق لتاريخ القيد يعني تقييماً بمعلومة لم تكن متاحة وقت العملية.
      if (fx.rate_date > ctx.accounting_date) {
        throw new UnprocessableEntityException(
          `${at}: تاريخ سعر الصرف (${fx.rate_date}) بعد تاريخ القيد (${ctx.accounting_date})`,
        );
      }
      rate = num(fx.rate);
      if (!(rate > 0)) throw new UnprocessableEntityException(`${at}: سعر صرف غير صالح`);
      fxDate = fx.rate_date;
      fxSource = fx.source;
      fxRateId = fx.id;
    }

    const debit_eur = round2(debit * rate);
    const credit_eur = round2(credit * rate);
    // التقريب لا يجوز أن يمحو مبلغاً قائماً — وإلا اختفت قيمة من الدفتر بصمت.
    if (debit > 0 && debit_eur === 0) throw new UnprocessableEntityException(`${at}: المبلغ يؤول إلى صفر باليورو`);
    if (credit > 0 && credit_eur === 0) throw new UnprocessableEntityException(`${at}: المبلغ يؤول إلى صفر باليورو`);

    td = round2(td + debit_eur);
    tc = round2(tc + credit_eur);

    lines.push({
      line_no: i + 1,
      account_id: account.id,
      debit, credit,
      transaction_currency: ccy,
      fx_rate: rate,
      fx_date: fxDate,
      fx_source: fxSource,
      fx_rate_id: fxRateId,
      debit_eur, credit_eur,
      vessel_id: raw.vessel_id ?? null,
      supplier_id: raw.supplier_id ?? null,
      customer_id: raw.customer_id ?? null,
      cost_center_id: raw.cost_center_id ?? null,
      description: raw.description ?? null,
    });
  });

  return { lines, total_debit_eur: td, total_credit_eur: tc };
}

/**
 * التوازن يُفحص باليورو وحده — والمطابقة **تامّة**.
 *
 * القيد متعدد العملات لا يتوازن بعملة المعاملة بطبيعته (سداد فاتورة بالدولار من
 * حساب باليورو)، فاشتراط ذلك خطأ محاسبي. أما فرق التقريب فلا يُسدّ بسطر تعديل
 * تلقائي في P1.1A: لا يوجد دليل حسابات بعد، وإنشاء حساب فروق من تلقاء النظام
 * قرار محاسبي لا يملكه النظام. يُرفض القيد ويُصحَّح عند مُعِدّه.
 */
export function assertBalanced(prepared: PreparedEntry): void {
  const diff = round2(prepared.total_debit_eur - prepared.total_credit_eur);
  if (diff !== 0) {
    throw new UnprocessableEntityException(
      `القيد غير متوازن باليورو: مدين ${prepared.total_debit_eur.toFixed(2)} · ` +
      `دائن ${prepared.total_credit_eur.toFixed(2)} · فرق ${diff.toFixed(2)}`,
    );
  }
}

/** إجماليات عملة المعاملة — للعرض والتقارير، لا للتوازن. لا تُجمع عملتان أبداً. */
export function totalsByCurrency(lines: PreparedLine[]): Record<string, { debit: number; credit: number }> {
  const out: Record<string, { debit: number; credit: number }> = {};
  for (const l of lines) {
    const b = (out[l.transaction_currency] ||= { debit: 0, credit: 0 });
    b.debit = round2(b.debit + l.debit);
    b.credit = round2(b.credit + l.credit);
  }
  return out;
}

// ── الفترة والتاريخ ─────────────────────────────────────────────────────────
export function assertDateInPeriod(accountingDate: string, period: PeriodRef): void {
  if (accountingDate < period.start_date || accountingDate > period.end_date) {
    throw new UnprocessableEntityException(
      `تاريخ القيد (${accountingDate}) خارج الفترة ${period.name ?? period.period_no} ` +
      `[${period.start_date} → ${period.end_date}]`,
    );
  }
}

/** الحدث الوحيد الذي تخصّه الفترة الافتتاحية. */
export const OPENING_EVENT = 'opening_balance';

/**
 * ── اختيار الفترة · الفترة 0 ليست يناير ──
 *
 * الفترة الافتتاحية والفترة الأولى **تتقاطعان في يوم واحد**: كلتاهما تغطّي
 * 2026-01-01. فاختيار «أول فترة تغطّي التاريخ» كان سيرسل كل حركة يناير الأولى
 * إلى الفترة الافتتاحية — ويخلط الرصيد المُرحَّل بنشاط السنة.
 *
 * القاعدة: **نوع الحدث هو ما يفصل، لا التاريخ.**
 *   opening_balance → الفترة 0 حصراً
 *   أي حدث آخر      → الفترة التشغيلية (period_no > 0)
 *
 * وبذلك يبقى 01/01/2026 تاريخاً واحداً يحمل معنيين منفصلين تماماً: رصيد مُرحَّل
 * في الفترة 0، وحركة تشغيلية في يناير — ولا يختلطان أبداً.
 */
export function selectPeriod(eventType: string, candidates: PeriodRef[]): PeriodRef {
  const opening = candidates.filter((p) => p.period_no === 0);
  const operational = candidates.filter((p) => p.period_no > 0)
    .sort((a, b) => a.period_no - b.period_no);

  if (eventType === OPENING_EVENT) {
    if (!opening.length) {
      throw new UnprocessableEntityException(
        'لا توجد فترة افتتاحية تغطّي هذا التاريخ — الرصيد المُرحَّل يخصّ الفترة 0 وحدها',
      );
    }
    return opening[0];
  }

  if (!operational.length) {
    throw new UnprocessableEntityException(
      'التاريخ لا تغطّيه فترة تشغيلية — الفترة الافتتاحية للأرصدة المُرحَّلة فقط',
    );
  }
  return operational[0];
}

/**
 * الرصيد الافتتاحي يمسّ المركز المالي لا نتيجة السنة.
 *
 * حسابات الإيرادات والمصروفات تبدأ السنة من الصفر بحكم الإقفال؛ فتحميلها برصيد
 * مُرحَّل يحقن نشاطاً في قائمة دخل 2026 لم يحدث فيها. ما يُرحَّل من نتيجة السنوات
 * السابقة يدخل حقوق الملكية (أرباح مُرحَّلة) لا حساب الإيراد أو المصروف.
 *
 * هذا يجعل «القيد الافتتاحي لا يؤثر على نتيجة 2026» **بنية لا عُرفاً**.
 */
export function assertOpeningBalanceAccounts(
  lines: { account_id: string; line_no: number }[],
  accounts: Map<string, AccountRef>,
): void {
  for (const l of lines) {
    const t = accounts.get(l.account_id)?.account_type;
    if (t === 'revenue' || t === 'expense') {
      throw new UnprocessableEntityException(
        `السطر ${l.line_no}: الرصيد الافتتاحي لا يُحمَّل على حساب ${t === 'revenue' ? 'إيراد' : 'مصروف'} — ` +
        'نتيجة السنوات السابقة تُرحَّل إلى حقوق الملكية',
      );
    }
  }
}

/**
 * حالة الفترة تحكم الترحيل:
 *   open        كل الترحيل مسموح
 *   soft_closed قيود التسوية وحدها — الحركة التشغيلية أُغلقت
 *   hard_closed مغلق نهائياً — التصحيح يكون في فترة لاحقة بقيد عكسي
 */
export function assertPeriodAcceptsPosting(
  period: PeriodRef,
  eventType: string,
): void {
  if (period.status === 'open') return;
  if (period.status === 'soft_closed') {
    if (eventType === 'adjustment' || eventType === 'reversal') return;
    throw new UnprocessableEntityException(
      'الفترة مُقفلة مبدئياً — لا يُقبل فيها إلا قيد تسوية أو عكس',
    );
  }
  throw new UnprocessableEntityException(
    'الفترة مُقفلة نهائياً — التصحيح يكون بقيد في فترة مفتوحة لاحقة',
  );
}

/** القيد بأثر رجعي واقعة تُعلَن لا تُخفى: يُوسَم ويلزمه سبب مكتوب. */
export function resolveBackdating(
  accountingDate: string,
  today: string,
  reason: string | null | undefined,
): { is_backdated: boolean; backdated_reason: string | null } {
  assertIsoDate(today, 'today');
  if (accountingDate >= today) return { is_backdated: false, backdated_reason: null };
  const r = (reason || '').trim();
  if (!r) {
    throw new UnprocessableEntityException(
      `تاريخ القيد (${accountingDate}) سابق لليوم — القيد بأثر رجعي يتطلب سبباً مكتوباً`,
    );
  }
  return { is_backdated: true, backdated_reason: r };
}

// ── الترقيم ─────────────────────────────────────────────────────────────────
/**
 * الرقم الرسمي يُسنَد **عند الترحيل** لا عند الإنشاء: المسوّدة الملغاة لا تحجز رقماً،
 * فلا تنشأ فجوة يعجز أحد عن تفسيرها للمدقق.
 */
export function formatEntryNo(prefix: string, year: number, seq: number): string {
  if (!prefix || !/^[A-Z0-9-]{1,10}$/.test(prefix)) {
    throw new BadRequestException('بادئة الدفتر غير صالحة');
  }
  if (!Number.isInteger(seq) || seq < 1) throw new BadRequestException('تسلسل غير صالح');
  return `${prefix}-${year}-${String(seq).padStart(5, '0')}`;
}

// ── الانتقالات ──────────────────────────────────────────────────────────────
export function assertCanEditDraft(status: string): void {
  if (status !== 'draft') {
    throw new ConflictException(
      status === 'void'
        ? 'القيد ملغى — لا يُعدَّل'
        : 'القيد مُرحَّل — التعديل ممنوع والتصحيح يكون بقيد عكسي',
    );
  }
}

export function assertCanPost(status: string): void {
  if (status === 'posted' || status === 'reversed') throw new ConflictException('القيد مُرحَّل بالفعل');
  if (status === 'void') throw new ConflictException('القيد ملغى — لا يُرحَّل');
  if (status !== 'draft') throw new ConflictException('حالة غير معروفة');
}

export function assertCanReverse(entry: { status: string; reversed_by_entry_id?: string | null }): void {
  if (entry.status === 'reversed' || entry.reversed_by_entry_id) {
    throw new ConflictException('القيد معكوس بالفعل — العكس لا يتكرر');
  }
  if (entry.status !== 'posted') throw new ConflictException('لا يُعكس إلا قيد مُرحَّل');
}

/**
 * أسطر القيد العكسي: تبديل الاتجاه **بسعر الصرف الأصلي نفسه**.
 *
 * استخدام سعر اليوم كان سيولّد فرق عملة لم يقع فعلاً — العكس تصحيح إجرائي
 * لا عملية اقتصادية جديدة.
 */
export function buildReversalLines(original: PreparedLine[]): PreparedLine[] {
  return original.map((l, i) => ({
    ...l,
    line_no: i + 1,
    debit: l.credit,
    credit: l.debit,
    debit_eur: l.credit_eur,
    credit_eur: l.debit_eur,
    description: l.description ? `عكس: ${l.description}` : 'عكس',
  }));
}

/** تاريخ العكس لا يسبق الأصل — وإلا ظهر أثر التصحيح قبل ما يصحّحه. */
export function assertReversalDate(originalDate: string, reversalDate: string): void {
  assertIsoDate(reversalDate, 'reversal_date');
  if (reversalDate < originalDate) {
    throw new UnprocessableEntityException(
      `تاريخ العكس (${reversalDate}) لا يجوز أن يسبق تاريخ القيد الأصلي (${originalDate})`,
    );
  }
}

/** حارس تفاوت نقدي عام — يُستخدم في المطابقات لا في التوازن (التوازن تامّ). */
export function moneyEquals(a: number, b: number): boolean {
  return Math.abs(a - b) < MONEY_TOL;
}
