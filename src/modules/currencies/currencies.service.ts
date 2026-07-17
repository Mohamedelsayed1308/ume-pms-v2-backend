import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Currency } from './currency.entity';

@Injectable()
export class CurrenciesService {
  constructor(@InjectRepository(Currency) private repo: Repository<Currency>) {}

  findAll() { return this.repo.find({ order: { code: 'ASC' } }); }
  findOne(id: string) { return this.repo.findOneBy({ id }); }
  create(data: Partial<Currency>) { return this.repo.save(data); }
  async update(id: string, data: Partial<Currency>) {
    await this.repo.update(id, data);
    return this.findOne(id);
  }
  async remove(id: string) { await this.repo.delete(id); return { deleted: true }; }

  async seed() {
    const defaults = [
      { code: 'USD', name: 'US Dollar', rate_to_usd: 1 },
      { code: 'EUR', name: 'Euro', rate_to_usd: 1.08 },
      { code: 'EGP', name: 'Egyptian Pound', rate_to_usd: 0.02 },
      { code: 'AED', name: 'UAE Dirham', rate_to_usd: 0.27 },
    ];
    for (const c of defaults) {
      const exists = await this.repo.findOneBy({ code: c.code });
      if (!exists) await this.repo.save(c);
    }
    return { seeded: true };
  }
}
