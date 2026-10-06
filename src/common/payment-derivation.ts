import { BadRequestException, UnprocessableEntityException } from '@nestjs/common';
import { InvoiceStatus } from '../modules/invoices/invoice.entity';

/**
 * ── R3B · اشتقاق حالة السداد ────────────────────────────────────────────────
 *
 * حالة السداد تُشتقّ من سجلات الدفع الفعلية وتطبيقات الإشعارات الدائنة **وحدها**.
 * approval_status لا يدخل في الاشتقاق إطلاقاً: هو سير عمل إداري، و`paid` فيه
 * تعني «معتمد للصرف».
 *
 * paid_amount حقل مشتقّ (cache) لا مصدر حقيقة؛ لا يُكتب إلا من هنا.
 */

/** تفاوت نقدي — أصغر من نصف قرش فلا يخلق فروقاً وهمية ولا يبتلع فرقاً حقيقياً. */
export const MONEY_TOL = 0.005;

export const normCcy = (c?: string | null) => (c || 'USD').trim().toUpperCase();
export const round2 = (n: any) => Math.round((Number(n) || 0) * 100) / 100;

export interface PaymentLike { amount: any; currency?: string | null }
export interface InvoiceLike { id?: string; currency?: string | null; total_amount: any; settlement_basis?: string | null }
/** تطبيق إشعارٍ دائن على فاتورة — `amount` موجبٌ دائماً (انظر `CreditAllocation`) */
export interface AllocationLike { credit_note_id: string; invoice_id: string; amount: any; currency?: string | null }

/** تسوية تاريخية موثَّقة: مغلقة بقرار إداري، وإعادة اشتقاقها تدمّر توسيم R3A. */
export function isLegacySettled(inv: { settlement_basis?: string | null }): boolean {
  return inv?.settlement_basis === 'pre_system_settled' || inv?.settlement_basis === 'credit_note';
}

/**
 * مجموع ما سُدّد فعلاً — بعملة الفاتورة حصراً، بلا أي تحويل عملات.
 *
 * = السدادات + ما طُبّق عليها من إشعاراتٍ دائنة − ما طُبّق منها (إن كانت هي إشعاراً).
 * فالفاتورة الموجبة يرتفع مسدَّدها بالتطبيق، والإشعار السالب ينزل مسدَّده نحو إجماليّه
 * السالب حتّى يُستنفد. والتطبيقات تُطابَق بمعرّف الفاتورة، فيلزم أن يحمله `inv`.
 */
export function actualPaid(inv: InvoiceLike, payments: PaymentLike[], allocations: AllocationLike[] = []): number {
  const c = normCcy(inv.currency);
  const cash = (payments || [])
    .filter((p) => normCcy(p.currency) === c)
    .reduce((s, p) => s + (Number(p.amount) || 0), 0);
  const applied = (allocations || [])
    .filter((a) => normCcy(a.currency) === c)
    .reduce((s, a) => s + (a.invoice_id === inv.id ? (Number(a.amount) || 0) : 0) - (a.credit_note_id === inv.id ? (Number(a.amount) || 0) : 0), 0);
  return round2(cash + applied);
}

/**
 * الحالة من الواقع لا من النية:
 *   0            → unpaid
 *   0 < x < total → partial
 *   x >= total    → paid
 * الفاتورة السالبة (إشعار دائن) تُعامَل بمقدارها المطلق فلا تُصنَّف «مدفوعة» خطأً.
 */
export function derivePaymentState(inv: InvoiceLike, payments: PaymentLike[], allocations: AllocationLike[] = []) {
  const paidAmount = actualPaid(inv, payments, allocations);
  const total = round2(inv.total_amount);
  const mag = Math.abs(paidAmount), totalMag = Math.abs(total);
  const status =
    mag <= MONEY_TOL ? InvoiceStatus.UNPAID
    : mag + MONEY_TOL >= totalMag ? InvoiceStatus.PAID
    : InvoiceStatus.PARTIAL;
  return { paidAmount, status };
}

// ── حرّاس إنشاء السداد ───────────────────────────────────────────────────────
// كلها تُفحص **قبل** أي كتابة. تدقيق R1 أثبت أن الحالات المخالفة القائمة = صفر،
// فالغائب كان الحارس لا المشكلة.

export function assertPositiveAmount(amount: any): void {
  const a = Number(amount);
  if (!isFinite(a) || a <= 0) {
    throw new BadRequestException(
      'مبلغ السداد يجب أن يكون أكبر من صفر. الإشعارات الدائنة والمرتجعات والتسويات ' +
      'لا تُمثَّل بسجل سداد عادي — لها تصميم مستقل.',
    );
  }
}

export function assertCurrencyMatch(invoiceCurrency: any, paymentCurrency: any): void {
  const inv = normCcy(invoiceCurrency), pay = normCcy(paymentCurrency);
  if (inv !== pay) {
    // لا تحويل عملات هنا: أي تحويل يحتاج سعر صرف وتاريخاً ومصدراً موثَّقاً.
    throw new UnprocessableEntityException(
      `عملة السداد (${pay}) تخالف عملة الفاتورة (${inv}). لا يجري النظام أي تحويل عملات تلقائي.`,
    );
  }
}

export function assertNoOverpayment(currentPaid: number, newAmount: any, invoiceTotal: any): void {
  const total = Math.abs(round2(invoiceTotal));
  const after = round2(Math.abs(round2(currentPaid)) + Math.abs(Number(newAmount) || 0));
  if (after > total + MONEY_TOL) {
    throw new UnprocessableEntityException(
      `السداد يتجاوز إجمالي الفاتورة: المسدَّد ${round2(currentPaid)} + ${round2(newAmount)} = ${after} ` +
      `مقابل إجمالي ${total}. الفرق لا يُخفى في paid_amount — يحتاج مسار تسوية معتمداً.`,
    );
  }
}

// ── تطبيق الإشعارات الدائنة في دفعةٍ واحدة ──────────────────────────────────

export interface BatchInvoice { id: string; invoice_number: string; supplier_id: string; currency?: string | null; total_amount: any; status?: string | null; settlement_basis?: string | null }
export interface BatchLine { invoice_id: string; amount: any }
export interface BatchCredit { credit_note_id: string; invoice_id: string; amount: any }

/**
 * يفحص دفعةً فيها سداداتٌ نقديّة وتطبيقاتُ إشعاراتٍ دائنة — قبل أيّ كتابة.
 *
 * `invoices`: كلّ فاتورةٍ وإشعارٍ في الدفعة بحالتها الحاليّة. `settled`: ما سُدّد من
 * كلٍّ منها حتّى الآن (`actualPaid`)، ومعرّفه مفتاحه. يُرجع الصافي النقديّ لكلّ عملة —
 * وهو مبلغ التحويل — أو يرمي بأوّل سببٍ يمنع الدفعة.
 */
export function assertCreditBatch(supplierId: string, invoices: BatchInvoice[], settled: Record<string, number>,
  lines: BatchLine[], credits: BatchCredit[]): Record<string, number> {
  const fail = (m: string): never => { throw new UnprocessableEntityException(m); };
  const byId = new Map(invoices.map((i) => [i.id, i]));
  const get = (id: string): BatchInvoice => byId.get(id) ?? fail(`فاتورةٌ غير موجودة في الدفعة: ${id}`);
  const open = (inv: BatchInvoice) => {
    if (inv.supplier_id !== supplierId) fail(`${inv.invoice_number} لمورّدٍ آخر — الدفعة لمورّدٍ واحد`);
    if (inv.status === 'cancelled') fail(`${inv.invoice_number} ملغاة`);
    if (isLegacySettled(inv)) fail(`${inv.invoice_number} تسويةٌ تاريخيّة مغلقة — لا تُسدَّد ولا يُطبَّق منها`);
  };

  if (!lines.length) fail('اختر فاتورةً واحدة على الأقلّ');
  const seen = new Set<string>();
  const cash = new Map<string, number>();
  for (const l of lines) {
    const inv = get(l.invoice_id);
    open(inv);
    if (seen.has(inv.id)) fail(`${inv.invoice_number} مكرّرة في الدفعة`);
    seen.add(inv.id);
    if (round2(inv.total_amount) <= 0) fail(`${inv.invoice_number} إشعارٌ دائن — يُطبَّق على فاتورة ولا يُسدَّد`);
    const a = Number(l.amount);
    if (!isFinite(a) || a < 0) fail(`المبلغ النقديّ للفاتورة ${inv.invoice_number} غير صالح`);
    cash.set(inv.id, round2(a));
  }

  const used = new Map<string, number>(), applied = new Map<string, number>();
  for (const c of credits) {
    const cn = get(c.credit_note_id), inv = get(c.invoice_id);
    open(cn);
    if (round2(cn.total_amount) >= 0) fail(`${cn.invoice_number} ليس إشعاراً دائناً (إجماليّه غير سالب)`);
    if (!seen.has(inv.id)) fail(`الإشعار ${cn.invoice_number} يُطبَّق على ${inv.invoice_number} وهي ليست في الدفعة`);
    if (normCcy(cn.currency) !== normCcy(inv.currency)) fail(`عملة الإشعار ${cn.invoice_number} تخالف عملة ${inv.invoice_number} — لا تحويل عملات`);
    const a = Number(c.amount);
    if (!isFinite(a) || a <= 0) fail(`مبلغ التطبيق من ${cn.invoice_number} غير صالح`);
    used.set(cn.id, round2((used.get(cn.id) || 0) + a));
    applied.set(inv.id, round2((applied.get(inv.id) || 0) + a));
  }
  for (const [id, u] of used) {
    const cn = get(id);
    const left = round2(Math.abs(round2(cn.total_amount)) - Math.abs(round2(settled[id] || 0)));
    if (u > left + MONEY_TOL) fail(`المطبَّق من ${cn.invoice_number} (${u}) أكبر من رصيده المتبقّي (${left})`);
  }
  const net: Record<string, number> = {};
  for (const [id, c] of cash) {
    const inv = get(id);
    const a = applied.get(id) || 0;
    if (c <= MONEY_TOL && a <= MONEY_TOL) fail(`لا مبلغ نقديّ ولا إشعار مطبَّق على ${inv.invoice_number}`);
    const after = round2((settled[id] || 0) + c + a);
    if (after > round2(inv.total_amount) + MONEY_TOL) {
      fail(`${inv.invoice_number}: المسدَّد ${round2(settled[id] || 0)} + نقديّ ${c} + إشعار ${a} = ${after} يتجاوز إجماليّها ${round2(inv.total_amount)}`);
    }
    const k = normCcy(inv.currency);
    net[k] = round2((net[k] || 0) + c);
  }
  return net;
}
