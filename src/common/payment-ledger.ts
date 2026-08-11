import { NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { DataSource, EntityManager, EntityTarget } from 'typeorm';
import {
  MONEY_TOL, round2, normCcy,
  assertPositiveAmount, assertCurrencyMatch, assertNoOverpayment,
} from './payment-derivation';

/**
 * ── R3C · دفتر سداد مشترك ───────────────────────────────────────────────────
 *
 * محرّك واحد لفواتير الإيجار والفواتير الإدارية بدل نسخ منطق R3B مرتين.
 * الاختلافات بينهما بيانات لا كود: اسم عمود الإجمالي، والمفتاح الأجنبي،
 * وأي مستندات خارج دورة السداد.
 *
 * القواعد المفروضة هنا:
 *   • مصدر الحقيقة = SUM(سجلات السداد) من قاعدة البيانات — لا العميل ولا الـcache.
 *   • كل شيء داخل معاملة واحدة مع قفل كتابة على صف الفاتورة.
 *   • السداد يرث عملة الفاتورة؛ لا تحويل عملات إطلاقاً.
 *   • الحذف يعيد الحساب من المتبقي، لا بالطرح.
 */
export interface LedgerConfig {
  invoiceEntity: EntityTarget<any>;
  paymentEntity: EntityTarget<any>;
  /** عمود المفتاح الأجنبي في جدول السدادات */
  fk: string;
  /** عمود إجمالي الفاتورة — يختلف بين الوحدتين */
  totalColumn: string;
  /**
   * مستندات خارج دورة السداد (إشعارات دائنة/مدينة في فواتير الإيجار).
   * حالتها المقصودة `issued`، وإعادة اشتقاقها كانت ستمسحها إلى `unpaid`.
   */
  isOutsidePaymentCycle?: (invoice: any) => boolean;
}

/** الحالة من الواقع: صفر ⇒ unpaid · جزئي ⇒ partial · مكتمل ⇒ paid. */
export function deriveStatus(actualPaid: number, total: number): 'unpaid' | 'partial' | 'paid' {
  const paid = Math.abs(round2(actualPaid)), t = Math.abs(round2(total));
  if (paid <= MONEY_TOL) return 'unpaid';
  return paid + MONEY_TOL >= t ? 'paid' : 'partial';
}

/** مجموع السدادات بعملة الفاتورة حصراً — أي عملة أخرى لا تُحتسب. */
export function sumInInvoiceCurrency(invoiceCurrency: any, payments: any[]): number {
  const c = normCcy(invoiceCurrency);
  return round2((payments || [])
    .filter((p) => normCcy(p.currency) === c)
    .reduce((s, p) => s + (Number(p.amount) || 0), 0));
}

async function recompute(m: EntityManager, cfg: LedgerConfig, invoiceId: string) {
  const invoice: any = await m.findOne(cfg.invoiceEntity, { where: { id: invoiceId } as any });
  if (!invoice) return;
  if (cfg.isOutsidePaymentCycle?.(invoice)) return;   // إشعار — لا يُعاد اشتقاقه

  const remaining = await m.find(cfg.paymentEntity, { where: { [cfg.fk]: invoiceId } as any });
  const paid = sumInInvoiceCurrency(invoice.currency, remaining as any[]);
  await m.update(cfg.invoiceEntity, invoiceId, {
    paid_amount: paid,
    status: deriveStatus(paid, invoice[cfg.totalColumn]),
  } as any);
}

/**
 * إنشاء سداد ذرّي. كل الحرّاس تُفحص قبل أي كتابة، والمجموع يُقرأ من القاعدة
 * تحت قفل الصف فلا يمرّ طلبان متزامنان يتجاوزان الإجمالي معاً.
 */
export async function addPaymentAtomic(ds: DataSource, cfg: LedgerConfig, invoiceId: string, body: any) {
  return ds.transaction(async (m) => {
    const invoice: any = await m.findOne(cfg.invoiceEntity, {
      where: { id: invoiceId } as any,
      lock: { mode: 'pessimistic_write' },
    });
    if (!invoice) throw new NotFoundException('الفاتورة غير موجودة');

    if (cfg.isOutsidePaymentCycle?.(invoice)) {
      throw new UnprocessableEntityException(
        'هذا المستند إشعار ولا يخضع لدورة السداد. الإشعارات الدائنة والمدينة تُعدّل الالتزام ولا تُسدَّد.',
      );
    }

    assertPositiveAmount(body?.amount);
    // العملة تُورَّث من الفاتورة قطعياً؛ لو أرسل العميل غيرها تُرفض بدل أن تُطبَّع صامتة
    assertCurrencyMatch(invoice.currency, body?.currency ?? invoice.currency);

    const existing = await m.find(cfg.paymentEntity, { where: { [cfg.fk]: invoiceId } as any });
    const current = sumInInvoiceCurrency(invoice.currency, existing as any[]);
    assertNoOverpayment(current, body.amount, invoice[cfg.totalColumn]);

    const saved = await m.save(cfg.paymentEntity, m.create(cfg.paymentEntity, {
      ...body, [cfg.fk]: invoiceId, currency: invoice.currency,
    } as any));

    await recompute(m, cfg, invoiceId);
    return Array.isArray(saved) ? saved[0] : saved;
  });
}

/** الحذف يعيد الحساب من السجلات المتبقية — لا بطرح المبلغ المحذوف. */
export async function removePaymentAtomic(ds: DataSource, cfg: LedgerConfig, invoiceId: string, paymentId: string) {
  return ds.transaction(async (m) => {
    const payment: any = await m.findOne(cfg.paymentEntity, { where: { id: paymentId } as any });
    if (!payment) return { success: false };

    await m.findOne(cfg.invoiceEntity, { where: { id: invoiceId } as any, lock: { mode: 'pessimistic_write' } });
    await m.delete(cfg.paymentEntity, paymentId);
    await recompute(m, cfg, invoiceId);
    return { success: true };
  });
}
