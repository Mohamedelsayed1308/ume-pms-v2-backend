import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AgencyHistory } from './agency-history.entity';

const INF = '9999-12-31';
const monthStart = (year: number, month: number) => `${year}-${String(month).padStart(2, '0')}-01`;

@Injectable()
export class AgencyService {
  constructor(@InjectRepository(AgencyHistory) private repo: Repository<AgencyHistory>) {}

  list() { return this.repo.find({ order: { ship_key: 'ASC', valid_from: 'ASC' } }); }

  // الوكيل الفعلي لسفينة في شهر معيّن — من تاريخ الوكالة.
  async resolveMap(): Promise<Record<string, AgencyHistory[]>> {
    const all = await this.repo.find();
    const map: Record<string, AgencyHistory[]> = {};
    for (const h of all) (map[h.ship_key] = map[h.ship_key] || []).push(h);
    return map;
  }

  static resolveFrom(history: AgencyHistory[] | undefined, year: number, month: number): { agency_key: string; agency_name_ar: string } | null {
    if (!history) return null;
    const d = monthStart(year, month);
    const hit = history.find((h) => h.valid_from <= d && (h.valid_to || INF) >= d);
    return hit ? { agency_key: hit.agency_key, agency_name_ar: hit.agency_name_ar } : null;
  }

  private overlaps(a: { valid_from: string; valid_to: string | null }, b: { valid_from: string; valid_to: string | null }): boolean {
    return a.valid_from <= (b.valid_to || INF) && b.valid_from <= (a.valid_to || INF);
  }

  async upsert(body: Partial<AgencyHistory> & { id?: string }): Promise<AgencyHistory> {
    if (!body.ship_key || !body.agency_key || !body.valid_from) throw new BadRequestException('ship_key, agency_key, valid_from مطلوبة');
    if (body.valid_to && body.valid_to < body.valid_from) throw new BadRequestException('valid_to قبل valid_from');
    const existing = await this.repo.find({ where: { ship_key: body.ship_key } });
    const candidate = { valid_from: body.valid_from!, valid_to: body.valid_to ?? null };
    for (const e of existing) {
      if (body.id && e.id === body.id) continue;
      if (this.overlaps(candidate, e)) throw new BadRequestException(`تداخل فترات لنفس السفينة مع ${e.agency_key} (${e.valid_from}→${e.valid_to || 'مفتوح'})`);
    }
    if (body.id) { await this.repo.update(body.id, body); return this.repo.findOneByOrFail({ id: body.id }); }
    return this.repo.save(this.repo.create(body));
  }

  // تغيير الوكالة: إغلاق الفترة المفتوحة الحالية ثم فتح فترة جديدة.
  async changeAgency(shipKey: string, newAgencyKey: string, newAgencyNameAr: string, fromDate: string, shipNameAr?: string): Promise<AgencyHistory> {
    const open = await this.repo.findOne({ where: { ship_key: shipKey, valid_to: null as any } });
    if (open) {
      const closeAt = new Date(new Date(fromDate).getTime() - 86400000).toISOString().slice(0, 10);
      if (closeAt < open.valid_from) throw new BadRequestException('تاريخ التغيير قبل بدء الفترة الحالية');
      await this.repo.update(open.id, { valid_to: closeAt });
    }
    return this.upsert({ ship_key: shipKey, ship_name_ar: shipNameAr, agency_key: newAgencyKey, agency_name_ar: newAgencyNameAr, valid_from: fromDate, valid_to: null });
  }

  async remove(id: string) { await this.repo.delete(id); return { deleted: true }; }
}
