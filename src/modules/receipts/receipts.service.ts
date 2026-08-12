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

  /**
   * قائمة عمل الاستلام — استعلام واحد.
   *
   * كانت الواجهة تسأل عن وقائع كل فاتورة على حدة، فصارت مئات الطلبات المتوازية
   * وعلقت الصفحة. العدّ والاستبعاد يتمّان هنا حيث البيانات، لا هناك حيث الشبكة.
   */
  pending(q: any) {
    const limit = Math.min(Number(q?.limit ?? 300), 1000);
    const entityId = q?.legal_entity_id ? String(q.legal_entity_id) : null;
    return this.ds.query(
      `SELECT i.id, i.invoice_number, i.currency, i.total_amount, i.invoice_date,
              i.approval_status, i.vessel_id, i.supplier_id,
              s.name AS supplier_name, v.name AS vessel_name,
              (SELECT COUNT(*)::int FROM goods_service_receipts r WHERE r.invoice_id = i.id) AS receipt_count
         FROM invoices i
         LEFT JOIN suppliers s ON s.id = i.supplier_id
         LEFT JOIN vessels   v ON v.id = i.vessel_id
         LEFT JOIN shipping_companies sc ON sc.id = v.shipping_company_id
        WHERE NOT EXISTS (
                SELECT 1 FROM journal_entries je
                 WHERE je.source_type = 'invoice' AND je.source_id = i.id AND je.status <> 'void')
          AND ($1::uuid IS NULL OR sc.legal_entity_id = $1::uuid)
        ORDER BY i.invoice_date DESC NULLS LAST
        LIMIT $2`, [entityId, limit]);
  }

  /** الأعداد التي تُعرض في البطاقات — محسوبة في قاعدة البيانات لا في المتصفّح. */
  async pendingSummary(q: any) {
    const entityId = q?.legal_entity_id ? String(q.legal_entity_id) : null;
    const [r] = await this.ds.query(
      `SELECT
         COUNT(*) FILTER (WHERE NOT posted AND receipts = 0)::int AS awaiting,
         COUNT(*) FILTER (WHERE NOT posted AND receipts > 0)::int AS confirmed,
         COUNT(*) FILTER (WHERE posted)::int                      AS in_ledger
       FROM (
         SELECT i.id,
                (SELECT COUNT(*) FROM goods_service_receipts r WHERE r.invoice_id = i.id) AS receipts,
                EXISTS (SELECT 1 FROM journal_entries je
                         WHERE je.source_type = 'invoice' AND je.source_id = i.id AND je.status <> 'void') AS posted
           FROM invoices i
           LEFT JOIN vessels v ON v.id = i.vessel_id
           LEFT JOIN shipping_companies sc ON sc.id = v.shipping_company_id
          WHERE ($1::uuid IS NULL OR sc.legal_entity_id = $1::uuid)) t`, [entityId]);
    return r;
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
