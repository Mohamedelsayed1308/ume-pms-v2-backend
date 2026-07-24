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
    const url = `https://drive.google.com/uc?export=download&id=${fileId}`;
    const response = await axios.get(url, { responseType: 'arraybuffer', timeout: 30000 });
    const workbook = XLSX.read(response.data, { type: 'buffer', cellDates: true });

    const vessels = ['Poseidon', 'Amal', 'Daleela'];
    const result: Record<string, { revenue: number; voyages: number }> = {};

    const from = new Date(dateFrom);
    const to = new Date(dateTo);
    // extend to end of day
    to.setHours(23, 59, 59, 999);

    for (const vesselName of vessels) {
      const sheet = workbook.Sheets[vesselName];
      if (!sheet) {
        result[vesselName.toLowerCase()] = { revenue: 0, voyages: 0 };
        continue;
      }

      const rows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });
      let revenue = 0;
      const voyageRefs = new Set<string>();

      for (const row of rows) {
        if (!row || row.length < 14) continue;

        // col index 2 = DATE (0-based), col 0 = REF#, col 12+13 = revenue
        const rawDate = row[2];
        const ref = row[0];

        if (!rawDate) continue;

        let rowDate: Date;
        if (rawDate instanceof Date) {
          rowDate = rawDate;
        } else if (typeof rawDate === 'number') {
          // Excel serial date
          rowDate = XLSX.SSF.parse_date_code
            ? new Date((rawDate - 25569) * 86400 * 1000)
            : new Date((rawDate - 25569) * 86400 * 1000);
        } else if (typeof rawDate === 'string') {
          rowDate = new Date(rawDate);
        } else {
          continue;
        }

        if (isNaN(rowDate.getTime())) continue;
        if (rowDate < from || rowDate > to) continue;

        // sum col 12 and 13 (freight + extras)
        const col12 = typeof row[12] === 'number' ? row[12] : 0;
        const col13 = typeof row[13] === 'number' ? row[13] : 0;
        revenue += col12 + col13;

        if (ref) voyageRefs.add(String(ref).trim());
      }

      result[vesselName.toLowerCase()] = { revenue: Math.round(revenue * 100) / 100, voyages: voyageRefs.size };
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

    const commissionRate = n(p.commission_rate) / 100;
    const perVoyageFee = n(p.per_voyage_fee);

    const commission = totalRevenue * commissionRate + totalVoyages * perVoyageFee + totalOverPax;
    const netProfit = totalRevenue - totalRent - commission;

    const ratioBadawi = n(p.ratio_badawi) / 100;
    const ratioIttihad = n(p.ratio_ittihad) / 100;

    const shareBadawi = netProfit * ratioBadawi;
    const shareIttihad = netProfit * ratioIttihad;

    const prevBadawi = n(p.balance_prev_badawi);
    const prevIttihad = n(p.balance_prev_ittihad);

    const cashSafagaBadawi = n(p.cash_safaga_badawi);
    const cashSafagaIttihad = n(p.cash_safaga_ittihad);
    const transfersBadawi = n(p.transfers_badawi);
    const transfersIttihad = n(p.transfers_ittihad);

    const balanceBadawi = prevBadawi + shareBadawi - cashSafagaBadawi - transfersBadawi;
    const balanceIttihad = prevIttihad + shareIttihad - cashSafagaIttihad - transfersIttihad;

    return {
      totalRevenue,
      totalVoyages,
      totalOverPax,
      totalRent,
      commission,
      netProfit,
      shareBadawi,
      shareIttihad,
      balanceBadawi,
      balanceIttihad,
    };
  }
}
