import * as XLSX from 'xlsx';
import { money, type ItemKind } from '../crew-salary.calc';

/**
 * تصدير CFM لمرتّبات مركبٍ في شهر — ورقة «Summary <CUR>» وورقة «Wage …» لكلّ بحّار.
 *
 * يُقرأ بالبحث عن العناوين لا بمواضع ثابتة (الخلايا المدمجة تُزيح الأعمدة بين
 * ملفّي الدولار واليورو). وكلّ قيمةٍ تحمل مصدرها: الورقة والصفّ والعمود.
 * لا صيغ تُحسب ولا روابط تُتبع — القيم المخزّنة وحدها.
 */

export interface Provenance { file?: string; sheet: string; row: number; column?: string }

export interface CfmSummaryRow {
  crew_id: string;
  name: string;
  rank: string;
  nationality: string;
  section: 'monthly' | 'final';
  pay_start: string | null;
  pay_end: string | null;
  payroll_days: number | null;
  columns: Record<string, string>;     // عنوان العمود ⇒ المبلغ (نصّاً عشريّاً)
  balance: string | null;
  provenance: Provenance;
}

export interface CfmReportedItem { kind: ItemKind; label: string; description: string; amount: string; provenance: Provenance }

export interface CfmSeafarer {
  crew_id: string;
  sheet: string;
  full_name: string;
  rank: string;
  nationality: string;
  contract_start: string | null;
  contract_end: string | null;
  embarkation: string | null;
  disembarkation: string | null;
  rates: { basic: string | null; fixed_ot: string | null; leave: string | null };
  items: CfmReportedItem[];            // كلّ بنود الاستحقاق والخصم كما في الورقة
  balance: string | null;
  bank: {
    beneficiary: string; address: string; bank: string; iban: string; account_number: string; swift: string; bank_code: string;
    provenance: Provenance;
  } | null;
}

export interface CfmExport {
  currency: string;
  month: string | null;                // YYYY-MM
  vessel: string | null;
  rows: CfmSummaryRow[];
  seafarers: CfmSeafarer[];
  grand_total_balance: string | null;
  warnings: string[];
}

const MONTHS: Record<string, string> = {
  january: '01', february: '02', march: '03', april: '04', may: '05', june: '06',
  july: '07', august: '08', september: '09', october: '10', november: '11', december: '12',
};

export function parseMonthName(s: string): string | null {
  const m = /([A-Za-z]+)\.?\s+(\d{4})/.exec(s || '');
  if (!m) return null;
  const mm = MONTHS[m[1].toLowerCase()] || Object.entries(MONTHS).find(([k]) => k.startsWith(m[1].toLowerCase().slice(0, 3)))?.[1];
  return mm ? `${m[2]}-${mm}` : null;
}

/** «04. Gubal Trader» ⇒ «Gubal Trader». */
export const cleanVessel = (s: string) => s.replace(/^\s*\d+\s*[.)-]\s*/, '').replace(/\s+/g, ' ').trim();

const txt = (v: unknown) => (v == null ? '' : String(v).replace(/ /g, ' ').replace(/\s+/g, ' ').trim());

/** رقمٌ تسلسليّ من Excel أو نصٌّ «YYYY-MM-DD» أو «DD.MM.YYYY» ⇒ ISO. */
export function excelDate(v: unknown): string | null {
  if (typeof v === 'number' && Number.isFinite(v) && v > 20000 && v < 80000) {
    const d = XLSX.SSF.parse_date_code(v);
    if (!d) return null;
    return `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`;
  }
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v.toISOString().slice(0, 10);
  const s = txt(v);
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})[./](\d{1,2})[./](\d{4})$/.exec(s);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return null;
}

const colName = (c: number) => XLSX.utils.encode_col(c);

function rowsOf(ws: XLSX.WorkSheet): unknown[][] {
  // من A1 دائماً — كي يطابق رقمُ الصفّ في المصدر رقمَه في Excel حتّى لو بدأ النطاق بعده
  const ref = ws['!ref'];
  if (!ref) return [];
  const e = XLSX.utils.decode_range(ref).e;
  return XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: null, blankrows: true, range: { s: { r: 0, c: 0 }, e } });
}

/** نوع البند من عنوانه ووصفه في ورقة البحّار — والمجهول «أخرى» لا يُخمَّن. */
export function cfmItemKind(label: string, description: string): ItemKind {
  const l = label.toLowerCase(), d = description.toLowerCase();
  if (l === 'basic wage') return 'basic';
  if (l === 'fixed overtime') return 'fixed_ot';
  if (l === 'leave pay') return 'leave';
  if (l === 'cash advance') return 'cash_advance';
  if (/lashing/.test(d)) return 'lashing';
  if (/1 day to sign off|sign ?off/.test(d)) return 'sign_off_day';
  if (/1 day to sign on|sign ?on/.test(d)) return 'sign_on_settlement';
  if (/luggage|baggage/.test(d)) return 'luggage';
  if (/difference in salary|salary difference|fitter/.test(d)) return 'salary_difference';
  if (l === 'bonus') return 'bonus';
  if (/deduct/.test(l)) return 'other_deduction';
  return 'other_earning';
}

export function readWorkbook(buf: Buffer): XLSX.WorkBook {
  // بلا صيغ ولا VBA ولا تنسيقات — القيم المخزّنة وحدها
  return XLSX.read(buf, { type: 'buffer', cellFormula: false, cellHTML: false, cellStyles: false, bookVBA: false, cellDates: false });
}

export function isCfmWorkbook(wb: XLSX.WorkBook): boolean {
  return wb.SheetNames.some((n) => /^Summary\s+[A-Z]{3}$/i.test(n.trim()));
}

export function parseCfm(buf: Buffer, file?: string): CfmExport {
  const wb = readWorkbook(buf);
  const summaryName = wb.SheetNames.find((n) => /^Summary\s+[A-Z]{3}$/i.test(n.trim()));
  if (!summaryName) throw new Error('ليس تصدير CFM: لا ورقة «Summary»');
  const currency = summaryName.trim().split(/\s+/)[1].toUpperCase();
  const out: CfmExport = { currency, month: null, vessel: null, rows: [], seafarers: [], grand_total_balance: null, warnings: [] };

  const rows = rowsOf(wb.Sheets[summaryName]);
  let headers: string[] | null = null;
  let section: 'monthly' | 'final' = 'monthly';
  rows.forEach((r, i) => {
    const cells = r.map(txt);
    const first = cells[0] || '';
    for (const c of cells) {
      if (!out.month && /^Month:/i.test(c)) out.month = parseMonthName(c.replace(/^Month:\s*/i, ''));
      if (!out.vessel && /^Vessel:/i.test(c)) out.vessel = cleanVessel(c.replace(/^Vessel:\s*/i, '')) || null;
    }
    if (/^Final Wages Account/i.test(first) || /^Signed off/i.test(first)) section = 'final';
    if (/^Monthly Wages Account/i.test(first)) section = 'monthly';
    if (first === 'No.' && cells.includes('ID')) { headers = cells; return; }
    if (/^Grand Total$/i.test(first) && headers) {
      const k = headers.indexOf('Balance');
      out.grand_total_balance = k >= 0 ? money(r[k]) : null;
      return;
    }
    if (!headers || !/^\d+$/.test(first) || !/^\d+$/.test(cells[1] || '')) return;
    const h = headers;
    const get = (name: string) => { const k = h.indexOf(name); return k < 0 ? null : r[k]; };
    const columns: Record<string, string> = {};
    h.forEach((name, k) => {
      if (!name || ['No.', 'ID', 'Name', 'Rank', 'Nationality', 'Pay Start', 'Pay End', 'Payroll Days'].includes(name)) return;
      const m = money(r[k]);
      if (m != null) columns[name] = m;
    });
    const days = Number(get('Payroll Days'));
    out.rows.push({
      crew_id: cells[1], name: txt(get('Name')), rank: txt(get('Rank')), nationality: txt(get('Nationality')),
      section,
      pay_start: excelDate(get('Pay Start')), pay_end: excelDate(get('Pay End')),
      payroll_days: Number.isFinite(days) && get('Payroll Days') != null ? days : null,
      columns, balance: money(get('Balance')),
      provenance: { file, sheet: summaryName, row: i + 1 },
    });
  });
  if (!out.month) out.warnings.push('لم يُعثر على الشهر في ورقة الملخّص');
  if (!out.vessel) out.warnings.push('لم يُعثر على اسم المركب في ورقة الملخّص');

  for (const name of wb.SheetNames) {
    if (!/^Wage\s/i.test(name)) continue;
    const s = parseSeafarerSheet(rowsOf(wb.Sheets[name]), name, file);
    if (s) out.seafarers.push(s);
    else out.warnings.push(`ورقة «${name}» بلا رقم بحّار — لم تُقرأ`);
  }
  return out;
}

function parseSeafarerSheet(rows: unknown[][], sheet: string, file?: string): CfmSeafarer | null {
  const label = (label: string): { value: unknown; row: number } | null => {
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      for (let c = 0; c < r.length; c++) {
        if (txt(r[c]).replace(/:$/, '').toLowerCase() === label.toLowerCase()) {
          // الخلايا المدمجة تُكرّر العنوان في جاراتها — يُتخطّى المكرّر
          const self = txt(r[c]);
          for (let k = c + 1; k < r.length; k++) if (r[k] != null && txt(r[k]) !== '' && txt(r[k]) !== self) return { value: r[k], row: i + 1 };
          return { value: null, row: i + 1 };
        }
      }
    }
    return null;
  };
  const id = txt(label('Seafarer ID')?.value);
  if (!/^\d+$/.test(id)) return null;
  const s: CfmSeafarer = {
    crew_id: id, sheet,
    full_name: txt(label('Full Name')?.value), rank: txt(label('Rank')?.value), nationality: txt(label('Nationality')?.value),
    contract_start: excelDate(label('Contract Start')?.value), contract_end: excelDate(label('Contract End')?.value),
    embarkation: excelDate(label('Embarkation')?.value), disembarkation: excelDate(label('Disembarkation')?.value),
    rates: { basic: null, fixed_ot: null, leave: null },
    items: [], balance: null, bank: null,
  };

  // الاستحقاقات: من ترويسة «EARNINGS» حتّى «Total Earnings»، ثمّ الخصومات حتّى «Total Deductions»
  let amountCol = -1, wagesCol = -1, zone: 'none' | 'earn' | 'ded' | 'bank' = 'none';
  const bank: Record<string, string> = {};
  let bankRow = 0;
  rows.forEach((r, i) => {
    const cells = r.map(txt);
    const first = cells[0] || '';
    if (first === 'EARNINGS') {
      zone = 'earn'; amountCol = cells.indexOf('AMOUNT'); wagesCol = cells.indexOf('WAGES'); return;
    }
    if (first === 'DEDUCTIONS') { zone = 'ded'; return; }
    if (/^Total (Earnings|Deductions)$/i.test(first)) { zone = 'none'; return; }
    if (first === 'Total Current Month') {
      s.balance = amountCol >= 0 ? money(r[amountCol]) ?? lastMoney(r) : lastMoney(r);
      return;
    }
    if (first === 'PAYMENT ACCOUNT DETAILS') { zone = 'bank'; bankRow = i + 1; return; }
    if (zone === 'bank' && first) {
      const v = cells.slice(1).find((x) => x !== '' && x !== first) || '';
      bank[first.toLowerCase()] = v;
      if (/^Dated/i.test(first)) zone = 'none';
      return;
    }
    if ((zone === 'earn' || zone === 'ded') && first) {
      const amount = amountCol >= 0 && money(r[amountCol]) != null ? money(r[amountCol]) : lastMoney(r);
      if (amount == null) return;
      // الوصف: أوّل نصٍّ غير رقميّ بعد العنوان
      const description = cells.slice(1).find((x, k) => x !== '' && x !== first && money(r[k + 1]) == null && !['€', '$', 'EUR', 'USD'].includes(x)) || '';
      const kind = zone === 'ded' && first.toLowerCase() !== 'cash advance' ? 'other_deduction' : cfmItemKind(first, description);
      if (kind === 'basic' || kind === 'fixed_ot' || kind === 'leave') {
        const w = wagesCol >= 0 ? money(r[wagesCol]) : null;
        s.rates[kind] = w;
      }
      s.items.push({ kind, label: first, description, amount, provenance: { file, sheet, row: i + 1, column: amountCol >= 0 ? colName(amountCol) : undefined } });
    }
  });
  if (bankRow) {
    const has = Object.entries(bank).some(([k, v]) => k !== 'dated' && v !== '' && !/^type/i.test(v));
    if (has) {
      s.bank = {
        beneficiary: bank['beneficiary'] || '', address: bank['beneficiary address'] || '', bank: bank['bank'] || '',
        iban: (bank['iban'] || '').replace(/\s+/g, ''), account_number: (bank['number'] || '').replace(/\s+/g, ''),
        swift: bank['bic/swift'] || '', bank_code: bank['bank code'] || '',
        provenance: { file, sheet, row: bankRow },
      };
    }
  }
  return s;
}

function lastMoney(r: unknown[]): string | null {
  for (let k = r.length - 1; k >= 0; k--) { const m = typeof r[k] === 'number' ? money(r[k]) : null; if (m != null) return m; }
  return null;
}
