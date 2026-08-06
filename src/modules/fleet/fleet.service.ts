import { Injectable, InternalServerErrorException } from '@nestjs/common';
import axios from 'axios';
import * as XLSX from 'xlsx';

// شيت جوجل المُجمّع لكل مراكب الأسطول (IMPORTRANGE) — قابل للتهيئة عبر متغير بيئة.
const SHEET_ID = process.env.FLEET_SHEET_ID || '1G7VU_z7WDZK6kq-7Sk_iLztJzmP-HlXe4ke6UtFn4fM';
const EXPORT_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=xlsx`;
const CACHE_MS = 5 * 60 * 1000; // 5 دقائق

export interface MonthRow {
  vessel: string; month: string; voyages: number; net: number; avgNet: number;
  revenue: number; expenses: number; liquidity: number;
  trucks: number; vehicles: number; passengers: number;
}
export interface VoyageRow {
  vessel: string; ref: string; date: string; month: string; direction: string;
  trucks: number; vehicles: number; passengers: number;
  revenue: number; commissions: number; expenses: number; net: number; liquidity: number; bunker: number;
}
export interface FleetData {
  vessels: string[];
  months: string[];
  monthly: MonthRow[];
  voyages: VoyageRow[];
  generatedAt: string;
}

let cache: { data: FleetData; at: number } | null = null;

const norm = (s: any) =>
  String(s ?? '').replace(/ـ/g, '').replace(/[ً-ْ]/g, '').replace(/\s+/g, ' ').trim();
const num = (v: any) => {
  if (v == null || v === '') return 0;
  if (typeof v === 'number') return isFinite(v) ? v : 0;
  const s = String(v);
  const neg = /^\s*\(.*\)\s*$/.test(s); // نمط محاسبي: (500) = -500
  const n = parseFloat(s.replace(/[,٬]/g, '').replace(/[^\d.\-]/g, ''));
  if (!isFinite(n)) return 0;
  return neg ? -Math.abs(n) : n;
};
// تحويل رقم تسلسلي (Excel) أو تاريخ نصّي إلى YYYY-MM
function toMonth(v: any): string | null {
  if (typeof v === 'number' && isFinite(v)) {
    const d = XLSX.SSF.parse_date_code(v);
    if (d && d.y) return `${d.y}-${String(d.m).padStart(2, '0')}`;
  }
  const s = String(v ?? '');
  let m = s.match(/(\d{4})[-/](\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}`;
  m = s.match(/(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}`;
  return null;
}
function toDate(v: any): string {
  if (typeof v === 'number' && isFinite(v)) {
    const d = XLSX.SSF.parse_date_code(v);
    if (d && d.y) return `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`;
  }
  return String(v ?? '');
}

// يبني خريطة (مفتاح منطقي → رقم عمود) من صف العناوين حسب كلمات مفتاحية
function colIndex(headers: any[], ...keywords: string[]): number {
  for (let i = 0; i < headers.length; i++) {
    const h = norm(headers[i]);
    if (h && keywords.every((k) => h.includes(k))) return i;
  }
  return -1;
}

function findHeaderRow(rows: any[][], mustHave: string[]): number {
  for (let r = 0; r < Math.min(6, rows.length); r++) {
    const line = norm((rows[r] || []).join('|'));
    if (mustHave.every((k) => line.includes(k))) return r;
  }
  return -1;
}

function parseMonthly(ws: XLSX.WorkSheet): MonthRow[] {
  const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });
  const hr = findHeaderRow(rows, ['المركب', 'الشهر']);
  if (hr < 0) return [];
  const H = rows[hr];
  const c = {
    vessel: colIndex(H, 'المركب'),
    month: colIndex(H, 'الشهر'),
    voyages: colIndex(H, 'عدد', 'الرحلات'),
    net: colIndex(H, 'اجمالي', 'الصافي') >= 0 ? colIndex(H, 'اجمالي', 'الصافي') : colIndex(H, 'إجمالي', 'الصافي'),
    revenue: colIndex(H, 'الايراد') >= 0 ? colIndex(H, 'الايراد') : colIndex(H, 'الإيراد'),
    expenses: colIndex(H, 'المصاريف'),
    liquidity: colIndex(H, 'السيولة'),
    trucks: colIndex(H, 'عدد', 'الشاحنات'),
    vehicles: colIndex(H, 'عدد', 'المركبات'),
    passengers: colIndex(H, 'عدد', 'الركاب'),
  };
  const out: MonthRow[] = [];
  for (let r = hr + 1; r < rows.length; r++) {
    const row = rows[r]; if (!row) continue;
    const vessel = norm(row[c.vessel]);
    const month = toMonth(row[c.month]);
    if (!vessel || !month) continue;
    const voyages = num(row[c.voyages]);
    const net = num(row[c.net]);
    out.push({
      vessel, month, voyages, net,
      avgNet: voyages ? net / voyages : 0,
      revenue: num(row[c.revenue]), expenses: num(row[c.expenses]), liquidity: num(row[c.liquidity]),
      trucks: num(row[c.trucks]), vehicles: num(row[c.vehicles]), passengers: num(row[c.passengers]),
    });
  }
  return out;
}

function parseVoyages(ws: XLSX.WorkSheet): VoyageRow[] {
  const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });
  const hr = findHeaderRow(rows, ['المركب', 'ref']);
  if (hr < 0) return [];
  const H = rows[hr];
  const c = {
    vessel: colIndex(H, 'المركب'),
    ref: colIndex(H, 'ref'),
    date: colIndex(H, 'التاريخ'),
    month: colIndex(H, 'الشهر'),
    direction: colIndex(H, 'النوع'),
    trucks: colIndex(H, 'عدد', 'الشاحنات'),
    vehicles: colIndex(H, 'عدد', 'المركبات'),
    passengers: colIndex(H, 'عدد', 'الركاب'),
    revenue: colIndex(H, 'الايراد') >= 0 ? colIndex(H, 'الايراد') : colIndex(H, 'الإيراد'),
    commissions: colIndex(H, 'العمولات'),
    expenses: colIndex(H, 'المصاريف'),
    net: colIndex(H, 'الصافي'),
    liquidity: colIndex(H, 'السيولة'),
    bunker: colIndex(H, 'بانكر') >= 0 ? colIndex(H, 'بانكر') : colIndex(H, 'بنكر'),
  };
  const out: VoyageRow[] = [];
  for (let r = hr + 1; r < rows.length; r++) {
    const row = rows[r]; if (!row) continue;
    const vessel = norm(row[c.vessel]);
    if (!vessel) continue;
    const month = toMonth(row[c.month]) || toMonth(row[c.date]);
    if (!month) continue;
    out.push({
      vessel, ref: String(row[c.ref] ?? ''), date: toDate(row[c.date]), month,
      direction: norm(row[c.direction]),
      trucks: num(row[c.trucks]), vehicles: num(row[c.vehicles]), passengers: num(row[c.passengers]),
      revenue: num(row[c.revenue]), commissions: num(row[c.commissions]), expenses: num(row[c.expenses]),
      net: num(row[c.net]), liquidity: num(row[c.liquidity]), bunker: num(row[c.bunker]),
    });
  }
  return out;
}

@Injectable()
export class FleetService {
  async getDashboard(refresh = false): Promise<FleetData> {
    if (!refresh && cache && Date.now() - cache.at < CACHE_MS) return cache.data;
    try {
      // لو الشيت مش عام، رابط التصدير بيرجّع صفحة HTML بـ 200 (مش خطأ HTTP) — فالتفسير هو اللي بيكشف ده.
      const res = await axios.get(EXPORT_URL, { responseType: 'arraybuffer', timeout: 30000 });
      const buf = Buffer.from(res.data);
      const wb = XLSX.read(buf, { type: 'buffer' });
      const monthlyWs = wb.Sheets['LookerMonthly'];
      const voyagesWs = wb.Sheets['LookerData'];
      const monthly = monthlyWs ? parseMonthly(monthlyWs) : [];
      const voyages = voyagesWs ? parseVoyages(voyagesWs) : [];
      if (!monthly.length) {
        // شيت فاضي أو اتغيّرت بنيته — ما نكسرش آخر كاش جيّد بنسخة فاضية
        if (cache) return cache.data;
        throw new Error('لم يتم العثور على بيانات في تبويب LookerMonthly (تأكد أن الشيت عام ومشارَك برابط)');
      }
      const vessels = [...new Set(monthly.map((m) => m.vessel))].sort();
      const months = [...new Set(monthly.map((m) => m.month))].sort();
      const data: FleetData = { vessels, months, monthly, voyages, generatedAt: new Date().toISOString() };
      cache = { data, at: Date.now() };
      return data;
    } catch (err: any) {
      if (cache) return cache.data; // ارجع لآخر نسخة ناجحة عند أي فشل (جلب أو تفسير)
      throw new InternalServerErrorException('تعذّر تحميل بيانات الأسطول: ' + (err?.message || 'خطأ'));
    }
  }
}
