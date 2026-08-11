import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { ManagementInvoice } from './management-invoice.entity';
import { ManagementPayment } from './management-payment.entity';
import { LedgerConfig, addPaymentAtomic, removePaymentAtomic } from '../../common/payment-ledger';

// الفواتير الإدارية نموذج أبسط: لا doc_type ولا إشعارات — كل مستند يخضع لدورة السداد.
// عمود الإجمالي اسمه `amount` لا `total_amount`، وهو الفارق الوحيد عن دفتر الإيجار.
export const MANAGEMENT_LEDGER: LedgerConfig = {
  invoiceEntity: ManagementInvoice,
  paymentEntity: ManagementPayment,
  fk: 'management_invoice_id',
  totalColumn: 'amount',
};

@Injectable()
export class ManagementPaymentsService {
  constructor(@InjectDataSource() private ds: DataSource) {}

  addPayment(invoiceId: string, body: any) {
    return addPaymentAtomic(this.ds, MANAGEMENT_LEDGER, invoiceId, body);
  }

  removePayment(invoiceId: string, paymentId: string) {
    return removePaymentAtomic(this.ds, MANAGEMENT_LEDGER, invoiceId, paymentId);
  }
}
