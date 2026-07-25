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

  // ── جلب وتحليل البيانات من Google Sheets (gviz API) ─────────────────────
  async fetchFromGoogleDrive(fileId: string, dateFrom: string, dateTo: string) {
    // Original spreadsheet ID (from the edit URL)
    const SPREADSHEET_ID = '1xBNKsoDdlh2q6uEoKNEf49Q3UdIR6cJz';

    const GIDS: Record<string, number> = {
      Poseidon: 1709309661,
      Amal: 432651161,
      Daleela: 1434981772,
    };

    const VESSEL_CONFIG: Record<string, { netCol: number; voyCol: number }> = {
      Poseidon: { netCol: 31, voyCol: 1 }, // AF=31, REF.# in col B
      Amal:     { netCol: 29, voyCol: 2 }, // AD=29, VOY in col C
      Daleela:  { netCol: 29, voyCol: 2 }, // AD=29
    };

    const vessels = ['Poseidon', 'Amal', 'Daleela'];
    const result: Record<string, { revenue: number; voyages: number }> = {};

    const from = new Date(dateFrom);
    const to = new Date(dateTo);
    to.setHours(23, 59, 59, 999);

    for (const vesselName of vessels) {
      const cfg = VESSEL_CONFIG[vesselName];
      try {
        // gviz API exports dates as formatted text strings (not serial numbers)
        const url = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?tqx=out:csv&gid=${GIDS[vesselName]}`;

        const res = await axios.get(url, {
          timeout: 30000,
          maxRedirects: 10,
          headers: { 'User-Agent': 'Mozilla/5.0' },
        });

        const wb = XLSX.read(res.data, { type: 'string', raw: true });
        const sheetKey = Object.keys(wb.Sheets)[0];
        const rows: any[][] = XLSX.utils.sheet_to_json(wb.Sheets[sheetKey], { header: 1, defval: null });

        console.log(`[gviz] ${vesselName} total rows: ${rows.length}`);

        let revenue = 0;
        const voyageRefs = new Set<string>();
        let matchedCount = 0;

        for (const row of rows) {
          if (!row || row.length < 4) continue;

          const rowType = String(row[0] ?? '').trim();
          if (rowType !== 'Exp.' && rowType !== 'Imp.') continue;

          const rawDate = row[3];
          if (rawDate === null || rawDate === undefined || rawDate === '') continue;

          const rowDate = this.parseDate(String(rawDate).trim());
          if (!rowDate || isNaN(rowDate.getTime())) continue;
          if (rowDate < from || rowDate > to) continue;

          const net = parseFloat(String(row[cfg.netCol] ?? '').replace(/,/g, '')) || 0;
          if (net === 0) continue;

          matchedCount++;
          if (matchedCount <= 5) {
            console.log(`[gviz] ${vesselName} match: type=${rowType} date="${rawDate}" col${cfg.netCol}=${net}`);
          }

          revenue += net;

          const voyRef = row[cfg.voyCol];
          if (voyRef !== null && voyRef !== undefined && voyRef !== '') {
            voyageRefs.add(String(voyRef).trim());
          }
        }

        console.log(`[gviz] ${vesselName} → revenue=${revenue}, voyages=${voyageRefs.size}, matched rows=${matchedCount}`);
        result[vesselName.toLowerCase()] = {
          revenue: Math.round(revenue * 100) / 100,
          voyages: voyageRefs.size,
        };
      } catch (e: any) {
        console.error(`[gviz] error for ${vesselName}:`, e?.message);
        result[vesselName.toLowerCase()] = { revenue: 0, voyages: 0 };
      }
    }

    return result;
  }

  private parseDate(raw: string): Date | null {
    if (!raw) return null;

    // Excel serial number
    const num = Number(raw);
    if (!isNaN(num) && num > 40000 && num < 60000) {
      return new Date((num - 25569) * 86400 * 1000);
    }

    // D/M/YYYY or M/D/YYYY — resolve ambiguity by number range
    const slashMatch = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (slashMatch) {
      const a = Number(slashMatch[1]);
      const b = Number(slashMatch[2]);
      const y = slashMatch[3];
      // if a > 12 → must be DD/MM/YYYY; if b > 12 → must be MM/DD/YYYY; else default DD/MM (Egyptian locale)
      const day   = a > 12 ? a : (b > 12 ? b : a);
      const month = a > 12 ? b : (b > 12 ? a : b);
      return new Date(`${y}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`);
    }

    // "June 21, 2026" or ISO or any JS-parseable format
    const parsed = new Date(raw);
    if (!isNaN(parsed.getTime())) return parsed;

    return null;
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
