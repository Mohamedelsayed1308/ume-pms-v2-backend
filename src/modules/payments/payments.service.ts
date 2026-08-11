import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository, InjectDataSource } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Payment } from './payment.entity';
import { Invoice } from '../invoices/invoice.entity';
import {
  actualPaid, derivePaymentState, isLegacySettled,
  assertPositiveAmount, assertCurrencyMatch, assertNoOverpayment,
} from '../../common/payment-derivation';

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

      // المجموع الحالي من قاعدة البيانات — لا من paid_amount المخزَّن ولا من العميل
      const existing = await m.find(Payment, { where: { invoice_id: invoiceId } });
      const current = actualPaid(invoice as any, existing as any);
      assertNoOverpayment(current, data.amount, invoice.total_amount);

      const saved = await m.save(Payment, m.create(Payment, { ...data, currency: invoice.currency } as any));
      const payment = Array.isArray(saved) ? saved[0] : saved;

      // إعادة الحساب من السجلات بعد الإدراج — لا جمع تفاضلي
      await this.recompute(m, invoiceId);
      return payment;
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
    const { paidAmount, status } = derivePaymentState(invoice as any, remaining as any);
    await m.update(Invoice, invoiceId, { paid_amount: paidAmount, status });
  }
}
