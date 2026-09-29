import { BadRequestException, ConflictException, HttpException, HttpStatus, Injectable } from '@nestjs/common';
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
   * يُستدعى داخل معاملةٍ تحمل قفل الشهر (`fxLock`).
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

  /**
   * حفظ أسعار شهرٍ كاملاً (بطاقة الأسعار) — تحت قفل الشهر نفسه الذي يأخذه إدخال أسعار المرتّبات
   * واعتماد إصداراتها، وبتحقّقٍ متفائل: `base` هي الأسعار كما قرأها العميل، فإن تغيّرت منذئذٍ
   * يُرفض الحفظ (409) ولا يضيع تحديثٌ أحد. وحفظٌ بلا `base` مرفوض (428) — لا استبدال أعمى.
   */
  async upsert(month: string, rates: any, base: unknown): Promise<ExchangeRate> {
    if (!rates || typeof rates !== 'object' || Array.isArray(rates)) throw new BadRequestException('الأسعار كائنٌ من العملات');
    if (base === undefined) {
      throw new HttpException('حدِّث الصفحة ثمّ احفظ — الحفظ يلزمه الأسعار كما قرأتَها (base)', HttpStatus.PRECONDITION_REQUIRED);
    }
    return this.repo.manager.transaction(async (m) => {
      await fxLock(m, month);
      const repo = m.getRepository(ExchangeRate);
      const row = await repo.findOne({ where: { month } });
      if (!sameRates(row?.rates || {}, base)) {
        throw new ConflictException({ message: 'تغيّرت أسعار هذا الشهر منذ فتحتَها — أُعيد تحميلها، راجِعها ثمّ احفظ', current: row?.rates || {} });
      }
      const next = row ?? repo.create({ month });
      next.rates = rates;
      return repo.save(next);
    });
  }
}

/** قفل أسعار الشهر — المفتاح نفسه الذي تأخذه وحدة المرتّبات (`crew_salary:fx:<month>`). */
export async function fxLock(m: EntityManager, month: string) {
  await m.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`crew_salary:fx:${month}`]);
}

/** تطابق مجموعتي أسعار قيمةً قيمة (الأرقام كما خُزِّنت، بلا اعتبارٍ لترتيب المفاتيح). */
export function sameRates(a: unknown, b: unknown): boolean {
  const norm = (x: unknown) => {
    const o = x && typeof x === 'object' && !Array.isArray(x) ? (x as Record<string, unknown>) : {};
    return Object.keys(o).filter((k) => o[k] !== null && o[k] !== undefined && o[k] !== '').sort().map((k) => `${k}=${Number(o[k])}`).join('|');
  };
  return norm(a) === norm(b);
}
