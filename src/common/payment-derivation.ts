import { BadRequestException, UnprocessableEntityException } from '@nestjs/common';
import { InvoiceStatus } from '../modules/invoices/invoice.entity';

/**
 * ── R3B · اشتقاق حالة السداد ────────────────────────────────────────────────
 *
 * حالة السداد تُشتقّ من سجلات الدفع الفعلية **وحدها**. approval_status لا يدخل
 * في الاشتقاق إطلاقاً: هو سير عمل إداري، و`paid` فيه تعني «معتمد للصرف».
 *
 * paid_amount حقل مشتقّ (cache) لا مصدر حقيقة؛ لا يُكتب إلا من هنا.
 */

/** تفاوت نقدي — أصغر من نصف قرش فلا يخلق فروقاً وهمية ولا يبتلع فرقاً حقيقياً. */
export const MONEY_TOL = 0.005;

export const normCcy = (c?: string | null) => (c || 'USD').trim().toUpperCase();
export const round2 = (n: any) => Math.round((Number(n) || 0) * 100) / 100;

export interface PaymentLike { amount: any; currency?: string | null }
export interface InvoiceLike { currency?: string | null; total_amount: any; settlement_basis?: string | null }

/** تسوية تاريخية موثَّقة: مغلقة بقرار إداري، وإعادة اشتقاقها تدمّر توسيم R3A. */
export function isLegacySettled(inv: { settlement_basis?: string | null }): boolean {
  return inv?.settlement_basis === 'pre_system_settled' || inv?.settlement_basis === 'credit_note';
}

/** مجموع السدادات الفعلية — بعملة الفاتورة حصراً، بلا أي تحويل عملات. */
export function actualPaid(inv: InvoiceLike, payments: PaymentLike[]): number {
  const c = normCcy(inv.currency);
  return round2((payments || [])
    .filter((p) => normCcy(p.currency) === c)
    .reduce((s, p) => s + (Number(p.amount) || 0), 0));
}

/**
 * الحالة من الواقع لا من النية:
 *   0            → unpaid
 *   0 < x < total → partial
 *   x >= total    → paid
 * الفاتورة السالبة (إشعار دائن) تُعامَل بمقدارها المطلق فلا تُصنَّف «مدفوعة» خطأً.
 */
export function derivePaymentState(inv: InvoiceLike, payments: PaymentLike[]) {
  const paidAmount = actualPaid(inv, payments);
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
