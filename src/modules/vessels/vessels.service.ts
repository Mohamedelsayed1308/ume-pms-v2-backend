import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Vessel } from './vessel.entity';
import { Invoice } from '../invoices/invoice.entity';
import { totalsByCurrency, legacyTotals, normalizeCurrency, round2 } from '../../common/currency-totals';

// أسطول الشركة — تُنشأ تلقائياً لو غير موجودة (مقارنة بالاسم بدون حساسية للرموز/المسافات)
const FLEET = ['Poseidon Express', 'Amman', 'Gubal Trader', 'Wasa Express', 'Alcudia Express', 'Bridge', 'Monte Express'];

@Injectable()
export class VesselsService implements OnModuleInit {
  constructor(
    @InjectRepository(Vessel) private repo: Repository<Vessel>,
    @InjectRepository(Invoice) private invoiceRepo: Repository<Invoice>,
  ) {}

  async onModuleInit() {
    const norm = (s: string) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const existing = await this.repo.find();
    const have = new Set(existing.map((v) => norm(v.name)));
    const toAdd = FLEET.filter((n) => !have.has(norm(n)));
    if (toAdd.length) await this.repo.save(toAdd.map((name) => ({ name })));
  }

  findAll() { return this.repo.find({ relations: { shipping_company: true }, order: { name: 'ASC' } }); }
  findOne(id: string) { return this.repo.findOne({ where: { id }, relations: { shipping_company: true } }); }
  create(data: any) {
    const clean = { ...data, shipping_company_id: data.shipping_company_id || null };
    return this.repo.save(clean);
  }
  async update(id: string, data: any) {
    const clean = { ...data, shipping_company_id: data.shipping_company_id || null };
    await this.repo.update(id, clean);
    return this.findOne(id);
  }
  async remove(id: string) { await this.repo.delete(id); return { deleted: true }; }

  // إحصاءات المركب — التجميع المالي مفصول لكل عملة (لا SUM عبر العملات)
  async getStats(vesselId: string) {
    const head = await this.repo
      .createQueryBuilder('v')
      .leftJoin('v.purchase_orders', 'po')
      .leftJoin('po.invoices', 'inv')
      .select('v.id', 'id')
      .addSelect('v.name', 'name')
      .addSelect('COUNT(DISTINCT po.supplier_id)', 'total_suppliers')
      .addSelect('COUNT(DISTINCT inv.id)', 'total_invoices')
      .where('v.id = :id', { id: vesselId })
      .getRawOne();
    if (!head) return null;

    // التجميع مُجمَّع في SQL لكن **مفصولاً بالعملة** — كل صف عملة مستقلة
    const rows = await this.invoiceRepo
      .createQueryBuilder('inv')
      .select('inv.currency', 'currency')
      .addSelect('COUNT(inv.id)', 'invoice_count')
      .addSelect('COALESCE(SUM(inv.total_amount), 0)', 'invoiced')
      .addSelect('COALESCE(SUM(inv.paid_amount), 0)', 'paid')
      .where('inv.vessel_id = :id', { id: vesselId })
      .groupBy('inv.currency')
      .getRawMany();

    const totals = rows.map((r) => {
      const invoiced = round2(Number(r.invoiced)), paid = round2(Number(r.paid));
      return { currency: normalizeCurrency(r.currency), invoiced, paid, outstanding: round2(invoiced - paid), invoiceCount: Number(r.invoice_count) };
    }).sort((a, b) => a.currency.localeCompare(b.currency));

    return { ...head, totalsByCurrency: totals, ...legacyTotals(totals) };
  }

  // موردو المركب — لكل مورد دفاتر منفصلة بالعملة.
  // الترتيب: عدد الفواتير تنازلياً ثم الاسم (Option A) — لأن الترتيب بمجموع مختلط
  // العملات يجعل مورداً بعملة أضعف يبدو أكبر. عدد الفواتير محايد عملياً ومستقر.
  async getSuppliersByVessel(vesselId: string) {
    const rows = await this.invoiceRepo
      .createQueryBuilder('inv')
      .leftJoin('inv.supplier', 's')
      .select('s.id', 'supplier_id')
      .addSelect('s.name', 'supplier_name')
      .addSelect('inv.currency', 'currency')
      .addSelect('COUNT(inv.id)', 'invoice_count')
      .addSelect('COALESCE(SUM(inv.total_amount), 0)', 'invoiced')
      .addSelect('COALESCE(SUM(inv.paid_amount), 0)', 'paid')
      .where('inv.vessel_id = :id', { id: vesselId })
      .andWhere('s.id IS NOT NULL')
      .groupBy('s.id, s.name, inv.currency')
      .getRawMany();

    const bySupplier = new Map<string, any>();
    for (const r of rows) {
      let e = bySupplier.get(r.supplier_id);
      if (!e) { e = { supplier_id: r.supplier_id, supplier_name: r.supplier_name, total_invoices: 0, totalsByCurrency: [] as any[] }; bySupplier.set(r.supplier_id, e); }
      const invoiced = round2(Number(r.invoiced)), paid = round2(Number(r.paid));
      e.totalsByCurrency.push({ currency: normalizeCurrency(r.currency), invoiced, paid, outstanding: round2(invoiced - paid), invoiceCount: Number(r.invoice_count) });
      e.total_invoices += Number(r.invoice_count);
    }

    return [...bySupplier.values()].map((e) => {
      e.totalsByCurrency.sort((a: any, b: any) => a.currency.localeCompare(b.currency));
      return { ...e, ...legacyTotals(e.totalsByCurrency) };
    }).sort((a, b) => b.total_invoices - a.total_invoices || String(a.supplier_name).localeCompare(String(b.supplier_name)));
  }
}
