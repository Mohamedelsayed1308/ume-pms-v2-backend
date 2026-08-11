import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { HireInvoice } from './hire-invoice.entity';
import { HirePayment } from './hire-payment.entity';
import { LedgerConfig, addPaymentAtomic, removePaymentAtomic } from '../../common/payment-ledger';

/**
 * فواتير الإيجار مستحقات على العملاء، ونموذج مستنداتها ليس نموذج الفواتير الأساسية:
 * `doc_type` قد يكون فاتورة أو إشعاراً دائناً أو مديناً، والإشعارات **خارج دورة السداد**
 * وحالتها المقصودة `issued`. إعادة اشتقاق حالتها من السدادات كانت ستمسحها إلى `unpaid`.
 */
export const HIRE_LEDGER: LedgerConfig = {
  invoiceEntity: HireInvoice,
  paymentEntity: HirePayment,
  fk: 'hire_invoice_id',
  totalColumn: 'total_amount',
  isOutsidePaymentCycle: (inv) => inv?.doc_type === 'credit_note' || inv?.doc_type === 'debit_note',
};

@Injectable()
export class HirePaymentsService {
  constructor(@InjectDataSource() private ds: DataSource) {}

  addPayment(invoiceId: string, body: any) {
    return addPaymentAtomic(this.ds, HIRE_LEDGER, invoiceId, body);
  }

  removePayment(invoiceId: string, paymentId: string) {
    return removePaymentAtomic(this.ds, HIRE_LEDGER, invoiceId, paymentId);
  }
}
