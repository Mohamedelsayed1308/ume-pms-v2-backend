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
      Amal: 319001398,
      Daleela: 1434981772,
    };

    const vessels = ['Poseidon', 'Amal', 'Daleela'];
    const result: Record<string, { revenue: number; voyages: number }> = {};

    const from = new Date(dateFrom);
    const to = new Date(dateTo);
    to.setHours(23, 59, 59, 999);

    for (const vesselName of vessels) {
      try {
        const PUBLISHED_ID = '2PACX-1vSJmX-7dFDzqZaP38HzRYLy6MqkmJeRscbg7uV2--Pi-92LIbPvYXomvrVZT7U9BA';
        const url = `https://docs.google.com/spreadsheets/d/e/${PUBLISHED_ID}/pub?gid=${GIDS[vesselName]}&single=true&output=csv`;
        console.log(`[fetch-excel] fetching ${vesselName}:`, url);

        const res = await axios.get(url, {
          timeout: 30000,
          maxRedirects: 10,
          headers: { 'User-Agent': 'Mozilla/5.0' },
        });

        // parse CSV
        const wb = XLSX.read(res.data, { type: 'string', raw: false });
        const sheetKey = Object.keys(wb.Sheets)[0];
        const rows: any[][] = XLSX.utils.sheet_to_json(wb.Sheets[sheetKey], { header: 1, defval: null });

        console.log(`[fetch-excel] ${vesselName} rows:`, rows.length);
        // log first 3 rows that have data in col3 (DATE)
        rows.filter(r => r && r[3] && r[3] !== 'DATE').slice(0, 3).forEach((r, i) =>
          console.log(`[fetch-excel] ${vesselName} data${i}:`, JSON.stringify(r.slice(0, 10)))
        );

        let revenue = 0;
        const voyageRefs = new Set<string>();

        const isAmal = vesselName === 'Amal';

        for (const row of rows) {
          if (!row || row.length < 4) continue;

          // col3 = DATE as Excel serial number
          const rawDate = row[3];
          if (rawDate === null || rawDate === undefined) continue;
          if (typeof rawDate === 'string' && isNaN(Number(rawDate))) continue;

          const serial = typeof rawDate === 'number' ? rawDate : Number(rawDate);
          if (isNaN(serial) || serial < 40000) continue; // تجاهل قيم غير منطقية

          // تحويل Excel serial إلى Date
          const rowDate = new Date((serial - 25569) * 86400 * 1000);
          if (isNaN(rowDate.getTime())) continue;
          if (rowDate < from || rowDate > to) continue;

          if (isAmal) {
            // Amal: col0=voyage, col1=Rev.Safaga, col2=Rev.Duba
            const rev1 = parseFloat(String(row[1] ?? '').replace(/,/g, '')) || 0;
            const rev2 = parseFloat(String(row[2] ?? '').replace(/,/g, '')) || 0;
            revenue += rev1 + rev2;
            const ref = row[0];
            if (ref && typeof ref === 'number') voyageRefs.add(String(ref));
          } else {
            // Poseidon/Daleela: col1=voyage, col6=FREIGHT
            const freight = parseFloat(String(row[6] ?? '').replace(/,/g, '')) || 0;
            revenue += freight;
            const ref = row[1];
            if (ref && typeof ref === 'number') voyageRefs.add(String(ref));
          }
        }

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
