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
  // توزيع النسب = (إجمالي إيراد - إجمالي إيجار) × ratio%
  // نتيجة نشاط بدوي  = توزيع_بدوي  - كاش_بدوي  + إيجار_بوسيدون
  // نتيجة نشاط اتحاد = توزيع_اتحاد - كاش_اتحاد + إيجار_امل + إيجار_دليلة
  // رصيد مرحّل = رصيد_سابق + نتيجة_نشاط - تحويلات
  calculate(p: ProfitPeriod) {
    const n = (v: any) => Number(v) || 0;

    const DAILY_RATES = { poseidon: 14000, amal: 13000, daleela: 12000 };
    const days = Math.max(0, Math.round(
      (new Date(p.date_to).getTime() - new Date(p.date_from).getTime()) / (1000 * 60 * 60 * 24)
    ) + 1);
    const poseidonRent = days * DAILY_RATES.poseidon;
    const amalRent     = days * DAILY_RATES.amal;
    const daleelaRent  = n(p.daleela_revenue) > 0 ? days * DAILY_RATES.daleela : 0;

    const totalRevenue = n(p.poseidon_revenue) + n(p.amal_revenue) + n(p.daleela_revenue)
                       + n(p.poseidon_over_pax) + n(p.amal_over_pax) + n(p.daleela_over_pax);
    const totalRent    = poseidonRent + amalRent + daleelaRent;
    const totalCommission = n(p.commission_amount);

    // الأساس الموزَّع = إيراد - إيجار (العمولة تُطرح وتُضاف → تلغي نفسها)
    const netForDistribution = totalRevenue - totalRent;
    const distributionBadawi  = netForDistribution * (n(p.ratio_badawi)  / 100);
    const distributionIttihad = netForDistribution * (n(p.ratio_ittihad) / 100);

    // نتيجة نشاط كل طرف = توزيع - كاش + إيجار العبارة الخاصة به
    const activityBadawi  = distributionBadawi  - n(p.cash_safaga_badawi)  + poseidonRent;
    const activityIttihad = distributionIttihad - n(p.cash_safaga_ittihad) + amalRent + daleelaRent;

    const balanceBadawi  = n(p.balance_prev_badawi)  + activityBadawi  - n(p.transfers_badawi);
    const balanceIttihad = n(p.balance_prev_ittihad) + activityIttihad - n(p.transfers_ittihad);

    return {
      totalRevenue, totalRent, totalCommission,
      netForDistribution,
      distributionBadawi, distributionIttihad,
      activityBadawi, activityIttihad,
      balanceBadawi, balanceIttihad,
      days, poseidonRent, amalRent, daleelaRent,
    };
  }
}
