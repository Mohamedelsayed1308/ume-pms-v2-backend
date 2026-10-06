import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository, InjectDataSource } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import { Payment, PaymentMethod, PaymentType } from './payment.entity';
import { CreditAllocation } from './credit-allocation.entity';
import { Invoice } from '../invoices/invoice.entity';
import {
  actualPaid, derivePaymentState, isLegacySettled,
  assertPositiveAmount, assertCurrencyMatch, assertNoOverpayment, assertCreditBatch,
  type BatchCredit, type BatchLine,
} from '../../common/payment-derivation';

/** تطبيقات الإشعارات الدائنة التي تمسّ فاتورةً — مطبَّقةً عليها أو منها */
const allocationsOf = (m: any, invoiceId: string): Promise<CreditAllocation[]> =>
  m.find(CreditAllocation, { where: [{ invoice_id: invoiceId }, { credit_note_id: invoiceId }] });

@Injectable()
export class PaymentsService {
  constructor(
    @InjectRepository(Payment) private repo: Repository<Payment>,
    @InjectDataSource() private ds: DataSource,
  ) {}

  findAll() {
    return this.repo.find({
      relations: { invoice: { supplier: true, vessel: true } },
      order: { created_at: 'DESC' },
    });
  }

  findOne(id: string) {
    return this.repo.findOne({ where: { id }, relations: { invoice: true } });
  }

  findByInvoice(invoiceId: string) {
    return this.repo.find({
      where: { invoice_id: invoiceId },
      order: { payment_date: 'ASC' },
    });
  }

  /**
   * ── R3B · إنشاء سداد ذرّي ────────────────────────────────────────────────
   *
   * كان السداد يُحفظ ثم تُحدَّث الفاتورة في استدعاءين منفصلين: فشل بينهما يترك
   * سداداً بلا انعكاس على الفاتورة. الآن كلاهما داخل معاملة واحدة مع قفل كتابة
   * على الفاتورة، فلا سباق بين سدادين متزامنين يتجاوزان الإجمالي معاً.
   *
   * كل الحرّاس تُفحص قبل أي كتابة، ومصدر المجموع دائماً قاعدة البيانات لا العميل.
   */
  async create(data: Partial<Payment>) {
    return this.ds.transaction(async (m) => {
      const invoiceId = (data as any)?.invoice_id;
      if (!invoiceId) throw new NotFoundException('الفاتورة غير محدَّدة');

      // قفل كتابة: يمنع سباق سدادين متزامنين على نفس الفاتورة
      const invoice = await m.findOne(Invoice, { where: { id: invoiceId }, lock: { mode: 'pessimistic_write' } });
      if (!invoice) throw new NotFoundException('الفاتورة غير موجودة');

      assertPositiveAmount(data.amount);
      assertCurrencyMatch(invoice.currency, data.currency ?? invoice.currency);

      // المجموع الحالي من قاعدة البيانات — سداداتٍ وتطبيقاتِ إشعارات — لا من paid_amount ولا من العميل
      const existing = await m.find(Payment, { where: { invoice_id: invoiceId } });
      const current = actualPaid(invoice as any, existing as any, await allocationsOf(m, invoiceId));
      assertNoOverpayment(current, data.amount, invoice.total_amount);

      const saved = await m.save(Payment, m.create(Payment, { ...data, currency: invoice.currency } as any));
      const payment = Array.isArray(saved) ? saved[0] : saved;

      // إعادة الحساب من السجلات بعد الإدراج — لا جمع تفاضلي
      await this.recompute(m, invoiceId);
      return payment;
    });
  }

  /**
   * ── دفعة لمورّد: سداداتٌ نقديّة وتطبيقاتُ إشعاراتٍ دائنة معاً ──────────────
   *
   * بأمر المالك ٦ أكتوبر ٢٠٢٦: المورّد يُصدر إشعاراً دائناً، فيُخصم من مبلغ التحويل.
   * فيُسجَّل لكلّ فاتورةٍ ما حُوّل لها نقداً (سداداً عاديّاً يُرحَّل على البنك)، ويُسجَّل
   * الإشعار تطبيقاً عليها (تسويةً داخل حساب المورّد لا تمسّ البنك).
   *
   * والكلّ في معاملةٍ واحدة بأقفالٍ على كلّ الفواتير والإشعارات (بترتيب معرّفاتها فلا
   * يتشابك قفلان): إمّا تُسجَّل الدفعة كاملةً أو لا شيء — فلا يُطبَّق إشعارٌ على فاتورةٍ
   * فشل سدادها، ولا تبقى فاتورةٌ نصف مسدَّدة لأنّ أختها رُفضت.
   */
  async createBatch(body: any, user = '') {
    const supplierId = String(body?.supplier_id || '');
    if (!supplierId) throw new BadRequestException('المورّد مطلوب');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(body?.payment_date || ''))) throw new BadRequestException('تاريخ الدفع مطلوب بصيغة YYYY-MM-DD');
    const lines: BatchLine[] = Array.isArray(body?.lines) ? body.lines : [];
    const credits: BatchCredit[] = Array.isArray(body?.credits) ? body.credits : [];
    const ids = [...new Set([...lines.map((l) => String(l?.invoice_id || '')), ...credits.flatMap((c) => [String(c?.credit_note_id || ''), String(c?.invoice_id || '')])])].filter(Boolean).sort();

    return this.ds.transaction(async (m) => {
      const invoices = await m.find(Invoice, { where: { id: In(ids) }, order: { id: 'ASC' }, lock: { mode: 'pessimistic_write' } });
      const payments = invoices.length ? await m.find(Payment, { where: { invoice_id: In(ids) } }) : [];
      const allocs = invoices.length ? await m.find(CreditAllocation, { where: [{ invoice_id: In(ids) }, { credit_note_id: In(ids) }] }) : [];
      const settled = Object.fromEntries(invoices.map((inv) => [inv.id,
        actualPaid(inv as any, payments.filter((p) => p.invoice_id === inv.id) as any, allocs as any)]));

      const transfer = assertCreditBatch(supplierId, invoices as any, settled, lines, credits);

      const ccyOf = new Map(invoices.map((i) => [i.id, i.currency]));
      const batchRef = randomUUID();
      const reference = body?.reference ? String(body.reference).slice(0, 200) : null;
      const notes = body?.notes ? String(body.notes) : null;
      const cashRows = lines.filter((l) => Number(l.amount) > 0).map((l) => m.create(Payment, {
        invoice_id: l.invoice_id, amount: Number(l.amount), currency: ccyOf.get(l.invoice_id),
        payment_date: body.payment_date,
        payment_type: Object.values(PaymentType).includes(body?.payment_type) ? body.payment_type : PaymentType.INSTALLMENT,
        payment_method: Object.values(PaymentMethod).includes(body?.payment_method) ? body.payment_method : PaymentMethod.BANK_TRANSFER,
        reference, notes,
      } as any));
      const creditRows = credits.map((c) => m.create(CreditAllocation, {
        credit_note_id: c.credit_note_id, invoice_id: c.invoice_id, amount: Number(c.amount).toFixed(2),
        currency: ccyOf.get(c.invoice_id) || '', allocation_date: body.payment_date,
        reference: reference || '', notes: notes || '', batch_ref: batchRef, created_by: user,
      }));
      const savedPayments = cashRows.length ? await m.save(Payment, cashRows) : [];
      const savedAllocations = creditRows.length ? await m.save(CreditAllocation, creditRows) : [];
      for (const inv of invoices) await this.recompute(m, inv.id);
      return { batch_ref: batchRef, transfer, payments: savedPayments, allocations: savedAllocations };
    });
  }

  /** تطبيقات الإشعارات الدائنة — للعرض في شاشة المدفوعات */
  listAllocations() {
    return this.ds.getRepository(CreditAllocation).find({
      relations: { credit_note: { supplier: true }, invoice: { supplier: true, vessel: true } },
      order: { created_at: 'DESC' },
    });
  }

  /** إلغاء تطبيق: يعود رصيد الإشعار، ويُعاد حساب الفاتورة والإشعار من السجلات */
  async removeAllocation(id: string) {
    return this.ds.transaction(async (m) => {
      const a = await m.findOne(CreditAllocation, { where: { id } });
      if (!a) return { deleted: false };
      for (const invId of [a.credit_note_id, a.invoice_id].sort()) {
        await m.findOne(Invoice, { where: { id: invId }, lock: { mode: 'pessimistic_write' } });
      }
      await m.delete(CreditAllocation, id);
      await this.recompute(m, a.invoice_id);
      await this.recompute(m, a.credit_note_id);
      return { deleted: true };
    });
  }

  /**
   * الحذف يُعيد الحساب من السجلات المتبقية، لا بطرح المبلغ المحذوف.
   * الطرح التفاضلي يراكم الانحراف ويخفي أي فساد سابق.
   */
  async remove(id: string) {
    return this.ds.transaction(async (m) => {
      const payment = await m.findOne(Payment, { where: { id } });
      if (!payment) return { deleted: false };

      await m.findOne(Invoice, { where: { id: payment.invoice_id }, lock: { mode: 'pessimistic_write' } });
      await m.delete(Payment, id);
      await this.recompute(m, payment.invoice_id);
      return { deleted: true };
    });
  }

  /** المسار الوحيد الذي يكتب paid_amount/status داخل هذه الخدمة. */
  private async recompute(m: any, invoiceId: string) {
    const invoice = await m.findOne(Invoice, { where: { id: invoiceId } });
    if (!invoice) return;
    if (isLegacySettled(invoice)) return;   // تسوية تاريخية — لا تُعاد كتابتها أبداً

    const remaining = await m.find(Payment, { where: { invoice_id: invoiceId } });
    const { paidAmount, status } = derivePaymentState(invoice as any, remaining as any, await allocationsOf(m, invoiceId));
    await m.update(Invoice, invoiceId, { paid_amount: paidAmount, status });
  }
}
