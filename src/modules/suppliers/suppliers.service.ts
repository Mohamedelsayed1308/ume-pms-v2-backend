import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Supplier } from './supplier.entity';

@Injectable()
export class SuppliersService {
  constructor(@InjectRepository(Supplier) private repo: Repository<Supplier>) {}

  findAll() { return this.repo.find({ order: { name: 'ASC' } }); }
  findOne(id: string) { return this.repo.findOneBy({ id }); }
  create(data: Partial<Supplier>) { return this.repo.save(data); }
  async update(id: string, data: Partial<Supplier>) {
    await this.repo.update(id, data);
    return this.findOne(id);
  }
  async remove(id: string) { await this.repo.delete(id); return { deleted: true }; }

  async getStats(supplierId: string) {
    const supplier = await this.repo.findOne({
      where: { id: supplierId },
      relations: { purchase_orders: { invoices: true } },
    });
    if (!supplier) return null;

    const pos = supplier.purchase_orders || [];
    const invoices = pos.flatMap((po) => po.invoices || []);
    const total_invoiced = invoices.reduce((s, i) => s + +i.total_amount, 0);
    const total_paid = invoices.reduce((s, i) => s + +i.paid_amount, 0);

    return {
      id: supplier.id,
      name: supplier.name,
      total_pos: pos.length,
      total_invoices: invoices.length,
      total_invoiced,
      total_paid,
      total_outstanding: total_invoiced - total_paid,
    };
  }
}
