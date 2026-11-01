import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ILike, Not, Repository } from 'typeorm';
import { Invoice, InvoiceStatus } from '../invoices/invoice.entity';
import { Vessel } from '../vessels/vessel.entity';

/**
 * فواتير مونتي من شاشة الفواتير لسكربت الكارت — قراءةٌ فقط (أمر المالك ١ نوفمبر ٢٠٢٦).
 * التصنيف (تأمين من الوثائق · وقود الخطّ في المتوسّط · بروفورما · إهلاك · أتعاب إدارة ثابتة) في السكربت لا هنا،
 * فالمسار يعيد الفاتورة كما سُجّلت بلا الملغاة.
 */
@Injectable()
export class MonteInvoicesService {
  constructor(
    @InjectRepository(Invoice) private invoices: Repository<Invoice>,
    @InjectRepository(Vessel) private vessels: Repository<Vessel>,
  ) {}

  async list() {
    const vessel = await this.vessels.findOne({ where: { name: ILike('Monte Express') } });
    if (!vessel) return { vessel: null, invoices: [] };
    const rows = await this.invoices.find({
      where: { vessel_id: vessel.id, status: Not(InvoiceStatus.CANCELLED) },
      relations: { supplier: true, item: true },
      order: { invoice_date: 'ASC' },
    });
    return {
      vessel: { id: vessel.id, name: vessel.name },
      invoices: rows.map((i) => ({
        id: i.id,
        number: i.invoice_number,
        date: i.invoice_date,
        currency: i.currency,
        amount: Number(i.total_amount),
        type: i.type,
        status: i.status,
        item: i.item?.name ?? null,
        line_items: i.line_items ?? null,
        depreciation_months: i.depreciation_months ?? null,
        supplier: i.supplier?.name ?? null,
        description: (i.description || '').slice(0, 200),
        by: i.created_by_name ?? null,
        created_at: i.created_at,
      })),
    };
  }
}
