import * as XLSX from 'xlsx';
import { money } from '../crew-salary.calc';
import { excelDate, readWorkbook, type Provenance } from './cfm.parser';

/**
 * مرفقات رسالة المرتّبات — يُعرف كلٌّ منها **بترويسته لا باسم ملفّه**:
 *
 * • كشف الصرف (بيانات البنك بالعربيّة + السلف باليورو + تاريخا الرفت والتعيين).
 * • كشف حسابات البنوك (كتلٌ: المستفيد، البنك، الفرع، الدولة، IBAN، Swift).
 * • قائمة الطاقم الكاملة (الرقم ⇐ الاسم والرتبة) — ويُترك منها الجواز والميلاد والعنوان:
 *   لا حاجة لها في المرتّبات، فلا تُقرأ ولا تُحفظ.
 *
 * أرقام الحسابات تبقى **نصوصاً** كما هي (لا تتحوّل أرقاماً فتفقد أصفارها).
 * والرقم القوميّ في كشف الصرف لا يُقرأ: لا يلزم للحساب، ولا قالب بنكٍ معتمد يطلبه بعد.
 * • ورقة نشاط اللاشينج (عدد الشاحنات والسيّارات) مرجعٌ داعم لا يُعاد منه حساب — مبالغ اللاشينج
 *   من الرسالة وكشف التوزيع.
 */

export interface PayoutRow {
  no: number;
  name: string;
  name_ar: string;
  rank: string;
  account_currency: string;          // كما في الكشف: USD · EUR
  account_number: string;
  branch: string;
  bank: string;
  beneficiary_ar: string;
  cash_advance_eur: string | null;
  cigarettes_usd: string | null;
  other_addition: string | null;
  bonus: string | null;
  other_deduction: string | null;
  sign_off: string | null;
  sign_on: string | null;
  provenance: Provenance;
}

export interface BankBlock {
  no: number;
  name: string;
  rank: string;
  beneficiary: string;
  bank: string;
  branch: string;
  country: string;
  iban_or_account: string;
  swift: string;
  provenance: Provenance;
}

export interface CrewListRow { crew_id: string; name: string; rank: string; nationality: string; provenance: Provenance }

export type AttachmentSheet =
  | { kind: 'payout'; rows: PayoutRow[]; vessel: string | null }
  | { kind: 'bank_blocks'; rows: BankBlock[] }
  | { kind: 'crew_list'; rows: CrewListRow[]; vessel: string | null; date: string | null }
  | { kind: 'lashing_activity' }
  | { kind: 'unknown' };

const txt = (v: unknown) => (v == null ? '' : String(v).replace(/ /g, ' ').replace(/\s+/g, ' ').trim());
/** رقم حسابٍ أو هويّة: نصٌّ بلا مسافات — والرقم العدديّ يُكتب بلا أسٍّ علميّ. */
const ident = (v: unknown) => {
  if (typeof v === 'number') return Number.isInteger(v) ? BigInt(Math.round(v)).toString() : String(v);
  return txt(v).replace(/\s+/g, '');
};

function rowsOf(ws: XLSX.WorkSheet): unknown[][] {
  // من A1 دائماً — كي يطابق رقمُ الصفّ في المصدر رقمَه في Excel حتّى لو بدأ النطاق بعده
  const ref = ws['!ref'];
  if (!ref) return [];
  const e = XLSX.utils.decode_range(ref).e;
  return XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: null, blankrows: true, range: { s: { r: 0, c: 0 }, e } });
}

export function parseAttachmentWorkbook(buf: Buffer, file?: string): AttachmentSheet {
  const wb = readWorkbook(buf);
  for (const sheet of wb.SheetNames) {
    const rows = rowsOf(wb.Sheets[sheet]);
    const flat = rows.slice(0, 12).map((r) => r.map(txt));
    const has = (s: string) => flat.some((r) => r.some((c) => c === s || c.startsWith(s)));
    if (has('رقم الحساب') && has('Name')) return parsePayout(rows, sheet, file);
    if (has('Surname & Name') && has('Bank details')) return parseBankBlocks(rows, sheet, file);
    if (has('Seafarer') && has('ID') && has('Rank')) return parseCrewList(rows, sheet, file);
    if (flat.some((r) => r.some((c) => /lashing bonus/i.test(c))) && has('DATE') && (has('CARS') || has('PAX'))) return { kind: 'lashing_activity' };
  }
  return { kind: 'unknown' };
}

function findHeader(rows: unknown[][], label: string, from = 0, to = 15): { row: number; col: number } | null {
  for (let i = from; i < Math.min(rows.length, to); i++) {
    const c = rows[i].findIndex((v) => txt(v) === label || txt(v).startsWith(label));
    if (c >= 0) return { row: i, col: c };
  }
  return null;
}

function parsePayout(rows: unknown[][], sheet: string, file?: string): AttachmentSheet {
  const col = (label: string) => findHeader(rows, label)?.col ?? -1;
  const c = {
    cur: col('عملة الحساب'), acc: col('رقم الحساب'), branch: col('الفرع'), bank: col('اسم البنك'),
    ben: col('اسم المستفيد'), add: col('Other Addition'), bonus: col('Bonus'), ded: col('Other Deduct'),
    adv: col('Cash Advance'), cig: col('Cigarettes'), off: col('الرفت'), on: col('التعيين'),
    rank: col('الرتبة'), nameAr: col('الإسم'), name: col('Name'), no: col('NO'),
  };
  const headerRow = findHeader(rows, 'رقم الحساب')?.row ?? 0;
  const vesselCell = rows.slice(0, 5).flat().map(txt).find((s) => /^Ro\/Pax:|^M\.?V\.?[/:]/i.test(s));
  const out: PayoutRow[] = [];
  const at = (r: unknown[], k: number) => (k >= 0 ? r[k] : null);
  const amt = (r: unknown[], k: number) => { const m = money(at(r, k)); return m != null && m !== '0' ? m : null; };
  for (let i = headerRow + 1; i < rows.length; i++) {
    const r = rows[i];
    const no = Number(txt(at(r, c.no)));
    const name = txt(at(r, c.name));
    if (!Number.isInteger(no) || no <= 0 || !name) continue;
    out.push({
      no, name, name_ar: txt(at(r, c.nameAr)), rank: txt(at(r, c.rank)),
      account_currency: normalizeCurrency(txt(at(r, c.cur))),
      account_number: ident(at(r, c.acc)), branch: txt(at(r, c.branch)), bank: txt(at(r, c.bank)),
      beneficiary_ar: txt(at(r, c.ben)),
      cash_advance_eur: amt(r, c.adv), cigarettes_usd: amt(r, c.cig),
      other_addition: amt(r, c.add), bonus: amt(r, c.bonus), other_deduction: amt(r, c.ded),
      sign_off: excelDate(at(r, c.off)), sign_on: excelDate(at(r, c.on)),
      provenance: { file, sheet, row: i + 1 },
    });
  }
  return { kind: 'payout', rows: out, vessel: vesselCell ? vesselCell.replace(/^[^:]+:\s*/, '') : null };
}

export function normalizeCurrency(s: string): string {
  const u = s.toUpperCase().trim();
  if (/^EURO?S?$|^€$/.test(u)) return 'EUR';
  if (/^US ?D(OLLAR)?S?$|^\$$/.test(u)) return 'USD';
  if (/^EGP$|جنيه/.test(u)) return 'EGP';
  return u;
}

function parseBankBlocks(rows: unknown[][], sheet: string, file?: string): AttachmentSheet {
  const out: BankBlock[] = [];
  let cur: BankBlock | null = null;
  const put = (label: string, v: string) => {
    if (!cur) return;
    const l = label.toLowerCase().replace(/:$/, '').trim();
    if (l === 'beneficiary') cur.beneficiary = v;
    else if (l === 'bank') cur.bank = v;
    else if (l === 'branch office') cur.branch = v;
    else if (l === 'country') cur.country = v;
    else if (/^iban/.test(l)) cur.iban_or_account = v.replace(/\s+/g, '');
    else if (/^swift|^bic/.test(l)) cur.swift = v;
  };
  rows.forEach((r, i) => {
    const cells = r.map(txt);
    const no = Number(cells[0]);
    if (cells[0] && Number.isInteger(no) && no > 0 && cells[1]) {
      cur = { no, name: cells[1], rank: cells[2] || '', beneficiary: '', bank: '', branch: '', country: '', iban_or_account: '', swift: '', provenance: { file, sheet, row: i + 1 } };
      out.push(cur);
    }
    const k = cells.findIndex((c) => /^(Beneficiary|Bank|Branch Office|Country|IBAN|Swift|BIC)/i.test(c) && c !== 'Bank details');
    if (k >= 0) put(cells[k], cells.slice(k + 1).find((x) => x !== '' && x !== cells[k]) || '');
  });
  return { kind: 'bank_blocks', rows: out };
}

function parseCrewList(rows: unknown[][], sheet: string, file?: string): AttachmentSheet {
  const h = findHeader(rows, 'Seafarer');
  if (!h) return { kind: 'unknown' };
  const head = rows[h.row].map(txt);
  const ci = (s: string) => head.indexOf(s);
  const [cId, cName, cRank, cNat] = [ci('ID'), ci('Seafarer'), ci('Rank'), ci('Nationality')];
  const out: CrewListRow[] = [];
  for (let i = h.row + 1; i < rows.length; i++) {
    const r = rows[i];
    const id = txt(r[cId]);
    if (!/^\d+$/.test(id)) continue;
    // الجواز والميلاد والعنوان لا تُقرأ أصلاً
    out.push({ crew_id: id, name: txt(r[cName]), rank: txt(r[cRank]), nationality: cNat >= 0 ? txt(r[cNat]) : '', provenance: { file, sheet, row: i + 1 } });
  }
  const top = rows.slice(0, h.row).map((r) => r.map(txt));
  const val = (label: string) => { const r = top.find((x) => x[0] === label); return r ? r.slice(1).find((x) => x !== '') || null : null; };
  const dRow = rows.slice(0, h.row).find((r) => txt(r[0]) === 'Date:');
  return { kind: 'crew_list', rows: out, vessel: val('Vessel Name:'), date: dRow ? excelDate(dRow.slice(1).find((x) => x != null)) : null };
}
