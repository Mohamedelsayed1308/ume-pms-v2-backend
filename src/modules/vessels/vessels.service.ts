import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Vessel } from './vessel.entity';

@Injectable()
export class VesselsService {
  constructor(@InjectRepository(Vessel) private repo: Repository<Vessel>) {}

  findAll() { return this.repo.find({ order: { name: 'ASC' } }); }
  findOne(id: string) { return this.repo.findOneBy({ id }); }
  create(data: Partial<Vessel>) { return this.repo.save(data); }
  async update(id: string, data: Partial<Vessel>) {
    await this.repo.update(id, data);
    return this.findOne(id);
  }
  async remove(id: string) { await this.repo.delete(id); return { deleted: true }; }

  async getStats(vesselId: string) {
    const result = await this.repo
      .createQueryBuilder('v')
      .leftJoin('v.purchase_orders', 'po')
      .leftJoin('po.invoices', 'inv')
      .select('v.id', 'id')
      .addSelect('v.name', 'name')
      .addSelect('COUNT(DISTINCT po.supplier_id)', 'total_suppliers')
      .addSelect('COUNT(DISTINCT inv.id)', 'total_invoices')
      .addSelect('SUM(inv.total_amount)', 'total_invoiced')
      .addSelect('SUM(inv.paid_amount)', 'total_paid')
      .where('v.id = :id', { id: vesselId })
      .getRawOne();
    return result;
  }

  async getSuppliersByVessel(vesselId: string) {
    return this.repo
      .createQueryBuilder('v')
      .leftJoin('v.purchase_orders', 'po')
      .leftJoin('po.supplier', 's')
      .leftJoin('po.invoices', 'inv')
      .select('s.id', 'supplier_id')
      .addSelect('s.name', 'supplier_name')
      .addSelect('COUNT(DISTINCT inv.id)', 'total_invoices')
      .addSelect('SUM(inv.total_amount)', 'total_amount')
      .addSelect('SUM(inv.paid_amount)', 'paid_amount')
      .where('v.id = :id', { id: vesselId })
      .groupBy('s.id, s.name')
      .orderBy('total_amount', 'DESC')
      .getRawMany();
  }
}
