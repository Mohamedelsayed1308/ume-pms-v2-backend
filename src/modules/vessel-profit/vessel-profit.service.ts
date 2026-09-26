import { Injectable, BadRequestException, InternalServerErrorException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import axios from 'axios';
import * as XLSX from 'xlsx';
import { VesselProfitData } from './vessel-profit.entity';
import {
  SHEET_VESSELS, voyagesFromData, SheetVoyage,
  LINE_VESSELS, lineVoyagesFromData, LineVoyage,
} from './vessel-profit-sheet';

const SHEET_ID = process.env.FLEET_SHEET_ID || '1G7VU_z7WDZK6kq-7Sk_iLztJzmP-HlXe4ke6UtFn4fM';
const EXPORT_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=xlsx`;
const CACHE_MS = 5 * 60 * 1000;

let cache: {
  at: number;
  voyages: Record<string, SheetVoyage[]>;
  // رحلات خطّ جدّة/سواكن بشكلها الخاصّ — من التحميل نفسه، فلا جلبٌ ثانٍ للشيت
  lines: Record<string, LineVoyage[]>;
} | null = null;

@Injectable()
export class VesselProfitService {
  constructor(@InjectRepository(VesselProfitData) private repo: Repository<VesselProfitData>) {}

  get(vessel: string) {
    return this.repo.findOne({ where: { vessel } });
  }

  /**
   * رحلات المركب من الشيت الموحّد.
   *
   * الشيت يُجلب مرّةً ويُقسَّم على المراكب جميعاً، فطلبُ مركبٍ ثانٍ خلال المهلة
   * لا يُعيد تحميل ملفٍّ يزيد على ميغابايت.
   *
   * ولا كاش عند الفشل: خطأٌ صريح خيرٌ من أرقامٍ قديمة تُعرض تحت شارة «مباشر».
   */
  async fromSheet(vessel: string): Promise<{ vessel: string; voyages: SheetVoyage[]; fetchedAt: string }> {
    if (!SHEET_VESSELS[vessel]) {
      throw new BadRequestException(`المركب «${vessel}» غير مُهيّأ للقراءة من الشيت`);
    }
    const c = await this.loadSheet();
    return {
      vessel,
      voyages: c.voyages[vessel] || [],
      fetchedAt: new Date(c.at).toISOString(),
    };
  }

  /** رحلات مركبٍ على خطّ جدّة/سواكن — بنودها كما هي. */
  async lineFromSheet(key: string): Promise<{ key: string; vessel: string; line: string; voyages: LineVoyage[]; fetchedAt: string }> {
    const spec = LINE_VESSELS[key];
    if (!spec) throw new BadRequestException(`المركب «${key}» غير مُهيّأ على خطّ جدّة/سواكن`);
    const c = await this.loadSheet();
    return { key, vessel: spec.vessel, line: spec.line, voyages: c.lines[key] || [], fetchedAt: new Date(c.at).toISOString() };
  }

  private async loadSheet() {
    if (!cache || Date.now() - cache.at > CACHE_MS) {
      let rows: any[][];
      try {
        const res = await axios.get(EXPORT_URL, { responseType: 'arraybuffer', timeout: 60000 });
        const wb = XLSX.read(Buffer.from(res.data), { type: 'buffer' });
        const ws = wb.Sheets['DATA'];
        if (!ws) throw new Error('ورقة DATA غير موجودة في الشيت');
        rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });
      } catch (err: any) {
        throw new InternalServerErrorException(
          'تعذّر قراءة الشيت الموحّد: ' + (err?.message || 'خطأ'),
        );
      }
      const byVessel: Record<string, SheetVoyage[]> = {};
      for (const key of Object.keys(SHEET_VESSELS)) byVessel[key] = voyagesFromData(rows, key);
      const lines: Record<string, LineVoyage[]> = {};
      for (const key of Object.keys(LINE_VESSELS)) lines[key] = lineVoyagesFromData(rows, key);
      cache = { at: Date.now(), voyages: byVessel, lines };
    }
    return cache;
  }

  async save(vessel: string, body: { voyages?: any; manual?: any }) {
    let row = await this.repo.findOne({ where: { vessel } });
    if (!row) row = this.repo.create({ vessel });
    if (body.voyages !== undefined) row.voyages = body.voyages;
    if (body.manual !== undefined) row.manual = body.manual;
    return this.repo.save(row);
  }
}
