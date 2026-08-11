import { Injectable, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Supplier } from './supplier.entity';
import { Invoice } from '../invoices/invoice.entity';
import { PurchaseOrder } from '../purchase-orders/purchase-order.entity';
import { totalsByCurrency, legacyTotals } from '../../common/currency-totals';

@Injectable()
export class SuppliersService {
  constructor(
    @InjectRepository(Supplier) private repo: Repository<Supplier>,
    @InjectRepository(Invoice) private invoiceRepo: Repository<Invoice>,
    @InjectRepository(PurchaseOrder) private poRepo: Repository<PurchaseOrder>,
  ) {}

  // دمج موردين مكررين في مورد واحد: تحويل الفواتير وأوامر الشراء ثم حذف الباقي
  async merge(keepId: string, removeIds: string[]) {
    const ids = (removeIds || []).filter((id) => id && id !== keepId);
    if (!ids.length) return { merged: 0 };
    const keep = await this.repo.findOneBy({ id: keepId });
    if (!keep) throw new ConflictException('المورد الأصلي غير موجود');
    // تحويل ثم حذف في معاملة واحدة (كله أو لا شيء)
    await this.repo.manager.transaction(async (m) => {
      await m.update(Invoice, { supplier_id: In(ids) }, { supplier_id: keepId });
      await m.update(PurchaseOrder, { supplier_id: In(ids) }, { supplier_id: keepId });
      await m.delete(Supplier, ids);
    });
    return { merged: ids.length };
  }

  // توحيد الاسم للمقارنة: حروف/أرقام فقط (يتجاهل المسافات وعلامات الترقيم وحالة الأحرف)
  private norm(s: string): string {
    return (s || '').toLowerCase().replace(/[^a-z0-9؀-ۿ]/g, '');
  }

  private async assertUniqueName(name: string, exceptId?: string) {
    const n = this.norm(name);
    if (!n) return;
    const all = await this.repo.find();
    const dup = all.find((s) => this.norm(s.name) === n && s.id !== exceptId);
    if (dup) throw new ConflictException(`مورد بنفس الاسم موجود بالفعل: "${dup.name}"`);
  }

  findAll() { return this.repo.find({ order: { name: 'ASC' } }); }
  findOne(id: string) { return this.repo.findOneBy({ id }); }
  async create(data: Partial<Supplier>) {
    await this.assertUniqueName(data.name || '');
    return this.repo.save(data);
  }
  async update(id: string, data: Partial<Supplier>) {
    if (data.name) await this.assertUniqueName(data.name, id);
    await this.repo.update(id, data);
    return this.findOne(id);
  }
  async remove(id: string) { await this.repo.delete(id); return { deleted: true }; }

  async getStats(supplierId: string) {
    const supplier = await this.repo.findOne({
      where: { id: supplierId },
      relations: { purchase_orders: true },
    });
    if (!supplier) return null;

    const pos = supplier.purchase_orders || [];
    // مصدر الحقيقة للعلاقة المالية = invoice.supplier_id، لا وجود أمر شراء.
    // أمر الشراء علاقة تشغيلية؛ ربط التجميع به كان يُسقط كل فاتورة بلا أمر شراء.
    // استعلام مباشر واحد ⇒ لا تكرار ناتج عن JOIN.
    const invoices = await this.invoiceRepo.find({
      where: { supplier_id: supplierId },
      select: { id: true, currency: true, total_amount: true, paid_amount: true },
    });
    // دفتر مستقل لكل عملة — لا يُجمع مبلغان بعملتين مختلفتين
    const totals = totalsByCurrency(invoices as any);
    const legacy = legacyTotals(totals);

    return {
      id: supplier.id,
      name: supplier.name,
      total_pos: pos.length,
      total_invoices: invoices.length,
      totalsByCurrency: totals,
      ...legacy, // currency · mixed_currency · total_invoiced/paid/outstanding (null عند التعدّد)
    };
  }
}
