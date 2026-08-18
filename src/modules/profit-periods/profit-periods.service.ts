import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ProfitPeriod } from './profit-period.entity';
import axios from 'axios';
import * as XLSX from 'xlsx';

@Injectable()
export class ProfitPeriodsService {
  constructor(
    @InjectRepository(ProfitPeriod) private repo: Repository<ProfitPeriod>,
  ) {}

  findAll() {
    return this.repo.find({ order: { date_from: 'DESC' } });
  }

  findOne(id: string) {
    return this.repo.findOne({ where: { id } });
  }

  async create(data: any) {
    const period = this.repo.create(data);
    return this.repo.save(period);
  }

  async update(id: string, data: any) {
    await this.repo.update(id, data);
    return this.findOne(id);
  }

  async remove(id: string) {
    await this.repo.delete(id);
    return { deleted: true };
  }

  /**
   * جلب الفترة من الشيت الموحّد.
   *
   * المسار الآخر يمرّ عبر Apps Script يقرأ إكسل درايف — وهو المصدر القديم نفسه
   * الذي صار الشيت يسحبه ثلاث مرّات يومياً. فالقراءة من الشيت مباشرةً تُلغي
   * وسيطاً وتُصيب النسخة التي عليها بقيّة النظام.
   *
   * ── ما لا يأتي منه ──
   * `cash_safaga` **دفعاتٌ مصروفة** لا إيراد، ولا وجود لها في دفتر المركب. تُترك
   * كما هي ولا تُصفَّر: تصفيرُها يرفع نتيجة النشاط بمقدارها بلا أن يُنبّه أحد.
   */
  async fetchFromUnifiedSheet(dateFrom: string, dateTo: string) {
    const SHEET_ID = process.env.FLEET_SHEET_ID || '1G7VU_z7WDZK6kq-7Sk_iLztJzmP-HlXe4ke6UtFn4fM';
    let rows: any[][];
    try {
      const res = await axios.get(
        `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=xlsx`,
        { responseType: 'arraybuffer', timeout: 60000 },
      );
      const wb = XLSX.read(Buffer.from(res.data), { type: 'buffer' });
      const ws = wb.Sheets['DATA'];
      if (!ws) throw new Error('ورقة DATA غير موجودة في الشيت');
      rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });
    } catch (err: any) {
      throw new Error('تعذّر قراءة الشيت الموحّد: ' + (err?.message || 'خطأ'));
    }

    const KEYS: Record<string, string> = { POSEIDON: 'poseidon', AMAL: 'amal', DALEELA: 'daleela' };
    const out: any = {
      poseidon: { revenue: 0, voyages: 0, commission: 0, bunker: 0 },
      amal:     { revenue: 0, voyages: 0, commission: 0, bunker: 0 },
      daleela:  { revenue: 0, voyages: 0, commission: 0, bunker: 0 },
    };
    const seen: string[] = [];

    for (const row of rows) {
      const raw = row && row[10];
      if (!raw) continue;
      let p: any;
      try { p = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { continue; }
      const key = KEYS[String(p?.vessel || '').toUpperCase()];
      if (!key) continue;
      // التاريخ من المغادرة، وعند غيابه من الوصول — كما تفعل بقيّة الشاشات
      const d = String(p.dateExp || p.dateImp || '').slice(0, 10);
      if (!d || d < dateFrom || d > dateTo) continue;
      out[key].revenue += Number(p.income) || 0;
      out[key].commission += Number(p.comm) || 0;
      out[key].bunker += Number(p.bnk) || 0;
      out[key].voyages += 1;
      seen.push(d);
    }
    for (const k of Object.keys(out)) {
      out[k].revenue = Math.round(out[k].revenue * 100) / 100;
      out[k].commission = Math.round(out[k].commission * 100) / 100;
      out[k].bunker = Math.round(out[k].bunker * 100) / 100;
    }
    seen.sort();
    out.source = {
      kind: 'unified-sheet',
      fetchedAt: new Date().toISOString(),
      matched: seen.length,
      firstDate: seen[0] || null,
      lastDate: seen[seen.length - 1] || null,
      note: 'الكاش المصروف لا يأتي من الشيت — يبقى كما هو',
    };
    return out;
  }

  private readonly APPS_SCRIPT_URL =
    'https://script.google.com/macros/s/AKfycbxmnoBIXKK94r_fJWYd2u-Jo2u8izhx1HH8be7OQR9gzF506bXKrKOnFy3VBRaTMcJI4A/exec';

  // ── جلب البيانات من Google Apps Script Web App ───────────────────────────
  async fetchFromGoogleDrive(
    fileId: string, dateFrom: string, dateTo: string,
    voyFrom?: number, voyTo?: number,
  ) {
    const params: any = { date_from: dateFrom, date_to: dateTo };
    if (voyFrom != null && voyTo != null) {
      params.voy_from = voyFrom;
      params.voy_to   = voyTo;
    }
    const res = await axios.get(this.APPS_SCRIPT_URL, {
      params,
      timeout: 60000,
      maxRedirects: 10,
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });
    console.log('[apps-script] response:', JSON.stringify(res.data));
    return res.data;
  }

  // ── جلب تواريخ نطاق رحلات Poseidon ──────────────────────────────────────
  async fetchVoyageDates(voyageFrom: number, voyageTo: number) {
    const res = await axios.get(this.APPS_SCRIPT_URL, {
      params: { voyage_from: voyageFrom, voyage_to: voyageTo },
      timeout: 30000,
      maxRedirects: 10,
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });
    return res.data;
  }

  // ── حساب التوزيع (منطق Excel) ─────────────────────────────────────────
  // الإيراد من الشيت يتضمن Over Pax بالفعل → لا يُضاف مرة ثانية
  // Over Pax يُوزَّع: بدوي = Poseidon×66.67% + Daleela×33.33%
  //                  اتحاد = Poseidon×33.33% + Amal×100% + Daleela×66.67%
  // البنكر يُضاف للرصيد النهائي: بدوي += bunker_badawi, اتحاد += bunker_ittihad
  calculate(p: ProfitPeriod) {
    const n = (v: any) => Number(v) || 0;

    const DAILY_RATES = { poseidon: 14000, amal: 13000, daleela: 12000 };
    const days = Math.max(0, Math.round(
      (new Date(p.date_to).getTime() - new Date(p.date_from).getTime()) / (1000 * 60 * 60 * 24)
    ) + 1);
    const poseidonRent = days * DAILY_RATES.poseidon;
    const amalRent     = days * DAILY_RATES.amal;
    const daleelaRent  = n(p.daleela_revenue) > 0 ? days * DAILY_RATES.daleela : 0;

    // الإيراد الإجمالي (Over Pax داخل إيراد العبارة من الشيت)
    const totalRevenue = n(p.poseidon_revenue) + n(p.amal_revenue) + n(p.daleela_revenue);
    const totalRent    = poseidonRent + amalRent + daleelaRent;
    const totalCommission = n(p.commission_amount);

    // الأساس الموزَّع = إيراد - إيجار
    const netForDistribution = totalRevenue - totalRent;
    const distributionBadawi  = netForDistribution * (n(p.ratio_badawi)  / 100);
    const distributionIttihad = netForDistribution * (n(p.ratio_ittihad) / 100);

    // توزيع Over Pax حسب معادلة Excel
    const overPaxBadawi  = n(p.poseidon_over_pax) * (2/3) + n(p.daleela_over_pax) * (1/3);
    const overPaxIttihad = n(p.poseidon_over_pax) * (1/3) + n(p.amal_over_pax) + n(p.daleela_over_pax) * (2/3);

    // نتيجة نشاط = توزيع - كاش + overPax_share + إيجار العبارة + بنكر
    const activityBadawi  = distributionBadawi  - n(p.cash_safaga_badawi)  + overPaxBadawi  + poseidonRent + n(p.bunker_badawi);
    const activityIttihad = distributionIttihad - n(p.cash_safaga_ittihad) + overPaxIttihad + amalRent + daleelaRent + n(p.bunker_ittihad);

    const balanceBadawi  = n(p.balance_prev_badawi)  + activityBadawi  - n(p.transfers_badawi);
    const balanceIttihad = n(p.balance_prev_ittihad) + activityIttihad - n(p.transfers_ittihad);

    return {
      totalRevenue, totalRent, totalCommission,
      netForDistribution,
      distributionBadawi, distributionIttihad,
      overPaxBadawi, overPaxIttihad,
      activityBadawi, activityIttihad,
      balanceBadawi, balanceIttihad,
      days, poseidonRent, amalRent, daleelaRent,
    };
  }
}
