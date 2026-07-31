import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ExchangeRate } from './exchange-rate.entity';

@Injectable()
export class ExchangeRatesService {
  constructor(
    @InjectRepository(ExchangeRate)
    private readonly repo: Repository<ExchangeRate>,
  ) {}

  // كل الشهور — تُرجَع كخريطة { 'YYYY-MM': { EGP: 50, ... } }
  async getAll(): Promise<Record<string, any>> {
    const rows = await this.repo.find();
    const map: Record<string, any> = {};
    for (const r of rows) map[r.month] = r.rates || {};
    return map;
  }

  async getMonth(month: string): Promise<any> {
    const row = await this.repo.findOne({ where: { month } });
    return row ? row.rates || {} : {};
  }

  // حفظ/تحديث أسعار شهر واحد
  async upsert(month: string, rates: any): Promise<ExchangeRate> {
    let row = await this.repo.findOne({ where: { month } });
    if (!row) {
      row = this.repo.create({ month, rates });
    } else {
      row.rates = rates;
    }
    return this.repo.save(row);
  }
}
