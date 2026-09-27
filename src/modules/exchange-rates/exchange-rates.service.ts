import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
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

  /**
   * يضبط عملةً واحدة في شهرٍ واحد **ذرّيّاً** — دمجٌ في صفّ الشهر بلا قراءةٍ ثمّ كتابة،
   * فلا يضيع تحديثٌ متزامن لعملةٍ أخرى، ولا يُمسّ غير المفتاح المعنيّ.
   * (مسار `upsert` القائم يستبدل الشهر كلّه كما هو — لم يتغيّر.)
   */
  async setOne(month: string, currency: string, perUsd: string, manager?: EntityManager): Promise<Record<string, unknown>> {
    const q = (manager ?? this.repo.manager);
    const rows = await q.query(
      `INSERT INTO exchange_rates (month, rates) VALUES ($1, jsonb_build_object($2::text, $3::numeric))
       ON CONFLICT (month) DO UPDATE SET rates = COALESCE(exchange_rates.rates, '{}'::jsonb) || jsonb_build_object($2::text, $3::numeric),
         updated_at = now()
       RETURNING rates`,
      [month, currency, perUsd],
    );
    return rows[0]?.rates || {};
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
