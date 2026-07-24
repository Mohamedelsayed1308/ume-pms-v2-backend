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

  // ── جلب وتحليل Excel من Google Drive ──────────────────────────────────
  async fetchFromGoogleDrive(fileId: string, dateFrom: string, dateTo: string) {
    const GIDS: Record<string, number> = {
      Poseidon: 1709309661,
      Amal: 432651161,
      Daleela: 1434981772,
    };

    // إعدادات كل مركب: عمود NET BALANCE وطريقة قراءة التاريخ
    const VESSEL_CONFIG: Record<string, { netCol: number; dateAsSerial: boolean; voyCol: number }> = {
      // Poseidon: تواريخ الرحلات 2026 نصوص "D/M/YYYY"، الصفوف الرقمية هي أقسام أخرى تُتجاهل
      Poseidon: { netCol: 31, dateAsSerial: false, voyCol: 1 },
      // Amal: التواريخ في CSV كـ serial رقمية (خلايا تاريخ حقيقية)
      Amal:     { netCol: 29, dateAsSerial: true,  voyCol: 2 },
      // Daleela: نصوص مثل "March 1, 2025"
      Daleela:  { netCol: 29, dateAsSerial: false, voyCol: 2 },
    };

    const vessels = ['Poseidon', 'Amal', 'Daleela'];
    const result: Record<string, { revenue: number; voyages: number }> = {};

    const from = new Date(dateFrom);
    const to = new Date(dateTo);
    to.setHours(23, 59, 59, 999);

    for (const vesselName of vessels) {
      const cfg = VESSEL_CONFIG[vesselName];
      try {
        const PUBLISHED_ID = '2PACX-1vSJmX-7dFDzqZaP38HzRYLy6MqkmJeRscbg7uV2--Pi-92LIbPvYXomvrVZT7U9BA';
        const url = `https://docs.google.com/spreadsheets/d/e/${PUBLISHED_ID}/pub?gid=${GIDS[vesselName]}&single=true&output=csv`;

        const res = await axios.get(url, { timeout: 30000, maxRedirects: 10, headers: { 'User-Agent': 'Mozilla/5.0' } });

        const wb = XLSX.read(res.data, { type: 'string', raw: false });
        const sheetKey = Object.keys(wb.Sheets)[0];
        const rows: any[][] = XLSX.utils.sheet_to_json(wb.Sheets[sheetKey], { header: 1, defval: null });

        console.log(`[fetch] ${vesselName} total rows: ${rows.length}, netCol: ${cfg.netCol}, dateAsSerial: ${cfg.dateAsSerial}`);

        let revenue = 0;
        const voyageRefs = new Set<string>();

        for (const row of rows) {
          if (!row || row.length < 4) continue;

          const rawDate = row[3];
          if (rawDate === null || rawDate === undefined) continue;

          let rowDate: Date;
          if (cfg.dateAsSerial) {
            // Amal: التاريخ كـ Excel serial رقمي
            const numVal = Number(rawDate);
            if (isNaN(numVal) || numVal <= 40000) continue;
            rowDate = new Date((numVal - 25569) * 86400 * 1000);
          } else {
            // Poseidon/Daleela: النص فقط — الصفوف الرقمية تُتجاهل (أقسام أخرى في الشيت)
            if (typeof rawDate !== 'string' || !rawDate.trim()) continue;
            const txt = rawDate.trim();
            const dmyMatch = txt.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
            if (dmyMatch) {
              rowDate = new Date(`${dmyMatch[3]}-${dmyMatch[2].padStart(2,'0')}-${dmyMatch[1].padStart(2,'0')}`);
            } else {
              rowDate = new Date(txt);
            }
          }

          if (isNaN(rowDate.getTime())) continue;
          if (rowDate < from || rowDate > to) continue;

          // فقط صفوف الرحلات (Exp./Imp.) — تجاهل صفوف الإجماليات والمصاريف
          const rowType = String(row[0] ?? '').trim();
          if (rowType !== 'Exp.' && rowType !== 'Imp.') continue;

          // قيمة NET BALANCE
          const net = parseFloat(String(row[cfg.netCol] ?? '').replace(/,/g, '')) || 0;
          revenue += net;

          // عد الرحلات الفريدة
          const voyRef = row[cfg.voyCol];
          if (voyRef !== null && voyRef !== undefined && voyRef !== '') {
            voyageRefs.add(String(voyRef));
          }
        }

        console.log(`[fetch] ${vesselName} → revenue=${revenue}, voyages=${voyageRefs.size}`);
        result[vesselName.toLowerCase()] = {
          revenue: Math.round(revenue * 100) / 100,
          voyages: voyageRefs.size,
        };
      } catch (e: any) {
        console.error(`[fetch-excel] error for ${vesselName}:`, e?.message);
        result[vesselName.toLowerCase()] = { revenue: 0, voyages: 0 };
      }
    }

    return result;
  }

  // ── حساب التوزيع ──────────────────────────────────────────────────────
  calculate(p: ProfitPeriod) {
    const n = (v: any) => Number(v) || 0;

    const totalRevenue = n(p.poseidon_revenue) + n(p.amal_revenue) + n(p.daleela_revenue);
    const totalVoyages = n(p.poseidon_voyages) + n(p.amal_voyages) + n(p.daleela_voyages);
    const totalOverPax = n(p.poseidon_over_pax) + n(p.amal_over_pax) + n(p.daleela_over_pax);
    const totalRent = n(p.poseidon_rent) + n(p.amal_rent) + n(p.daleela_rent);

    const commission = totalRevenue * (n(p.commission_rate) / 100) + totalVoyages * n(p.per_voyage_fee) + totalOverPax;
    const netProfit = totalRevenue - totalRent - commission;

    const shareBadawi = netProfit * (n(p.ratio_badawi) / 100);
    const shareIttihad = netProfit * (n(p.ratio_ittihad) / 100);

    const balanceBadawi = n(p.balance_prev_badawi) + shareBadawi - n(p.cash_safaga_badawi) - n(p.transfers_badawi);
    const balanceIttihad = n(p.balance_prev_ittihad) + shareIttihad - n(p.cash_safaga_ittihad) - n(p.transfers_ittihad);

    return { totalRevenue, totalVoyages, totalOverPax, totalRent, commission, netProfit, shareBadawi, shareIttihad, balanceBadawi, balanceIttihad };
  }
}
