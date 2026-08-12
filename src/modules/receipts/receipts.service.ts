import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { GoodsServiceReceipt } from './goods-service-receipt.entity';
import {
  RECEIPT_TYPES, ReceiptType, AccrualCategory,
  evaluateAccrualEligibility, EligibilityVerdict,
} from './receipt-eligibility';

@Injectable()
export class ReceiptsService {
  constructor(@InjectDataSource() private ds: DataSource) {}

  list(invoiceId: string) {
    return this.ds.getRepository(GoodsServiceReceipt).find({
      where: { invoice_id: invoiceId }, order: { received_date: 'ASC' },
    });
  }

  async create(invoiceId: string, body: any, userId: string | null, userName: string | null) {
    const inv = await this.ds.query('SELECT id, approval_status FROM invoices WHERE id = $1', [invoiceId]);
    if (!inv.length) throw new NotFoundException('الفاتورة غير موجودة');

    const type = String(body?.receipt_type || '').trim() as ReceiptType;
    if (!RECEIPT_TYPES.includes(type)) {
      throw new BadRequestException(`نوع استلام غير معروف — المسموح: ${RECEIPT_TYPES.join(' · ')}`);
    }
    const date = String(body?.received_date || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new BadRequestException('received_date بصيغة YYYY-MM-DD مطلوب');

    // الإقرار الإداري بديلٌ عن دليل غائب، فيلزمه مرجع يُسأل عنه صاحبه.
    if (type === 'MANAGEMENT_RECEIPT_CONFIRMATION' && !String(body?.reference || '').trim()) {
      throw new BadRequestException('الإقرار الإداري يحتاج مرجعاً صريحاً — لا يُسجَّل بلا سند يُراجَع');
    }

    const repo = this.ds.getRepository(GoodsServiceReceipt);
    return repo.save(repo.create({
      invoice_id: invoiceId, receipt_type: type, received_date: date,
      received_by: body?.received_by ?? userId,
      received_by_name: body?.received_by_name ?? userName ?? null,
      reference: body?.reference ?? null,
      notes: body?.notes ?? null,
      attachment_id: body?.attachment_id ?? null,
      is_partial: !!body?.is_partial,
      created_by: userId,
    }));
  }

  /** ما تسأله خدمة الترحيل قبل إثبات أي فاتورة. */
  async eligibility(invoiceId: string, q: any): Promise<EligibilityVerdict & { invoice_id: string }> {
    const inv = await this.ds.query('SELECT id, approval_status FROM invoices WHERE id = $1', [invoiceId]);
    if (!inv.length) throw new NotFoundException('الفاتورة غير موجودة');

    const category = String(q?.category || 'GOODS').toUpperCase() as AccrualCategory;
    if (category !== 'GOODS' && category !== 'PERIOD_SERVICE') {
      throw new BadRequestException('category يجب أن تكون GOODS أو PERIOD_SERVICE');
    }
    const receipts = await this.list(invoiceId);
    const verdict = evaluateAccrualEligibility({
      category,
      approval_status: inv[0].approval_status,
      receipts: receipts.map((r) => ({ receipt_type: r.receipt_type as ReceiptType, received_date: r.received_date })),
      service_period_end: q?.service_period_end ?? null,
      as_of: q?.as_of ?? undefined,
    });
    return { invoice_id: invoiceId, ...verdict };
  }
}
