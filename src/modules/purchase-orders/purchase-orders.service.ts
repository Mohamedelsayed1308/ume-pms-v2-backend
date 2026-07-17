import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PurchaseOrder } from './purchase-order.entity';

@Injectable()
export class PurchaseOrdersService {
  constructor(@InjectRepository(PurchaseOrder) private repo: Repository<PurchaseOrder>) {}

  findAll() {
    return this.repo.find({
      relations: { supplier: true, vessel: true },
      order: { created_at: 'DESC' },
    });
  }

  findOne(id: string) {
    return this.repo.findOne({
      where: { id },
      relations: { supplier: true, vessel: true, invoices: true },
    });
  }

  create(data: Partial<PurchaseOrder>) { return this.repo.save(data); }

  async update(id: string, data: Partial<PurchaseOrder>) {
    await this.repo.update(id, data);
    return this.findOne(id);
  }

  async remove(id: string) { await this.repo.delete(id); return { deleted: true }; }
}
