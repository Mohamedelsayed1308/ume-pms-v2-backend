import * as XLSX from 'xlsx';
import type { Difference, EntryResult } from './crew-salary.calc';

/**
 * ملفّا Excel لمرتّبات الأطقم — منطقٌ خالص يأخذ لقطةً ويُعيد ملفّاً.
 *
 * • **كشف المراجعة**: كلّ البنود بمصادرها وفروقها — للمراجعة لا للصرف.
 * • **كشف الصرف المعتمد**: من إصدارٍ معتمدٍ وحده، وبعملةٍ واحدة، وللحالات المكتملة وحدها
 *   (حسابٌ معتمد، وتفويضٌ ساري إن كان المستفيد غير البحّار). والتصدير **ليس سداداً**.
 *   وهو كشفٌ عامّ — لا يُسمّى «جاهزاً للبنك»: قالب كلّ بنكٍ يُضاف لاحقاً فوق هذه البيانات.
 *
 * ── الأمان ──
 * كلّ نصٍّ يبدأ بـ = + - @ أو محرف تحكّم يُسبق بفاصلةٍ عليا فلا يُفسَّر صيغة.
 * والأرقام التعريفيّة (رقم البحّار، الحساب، IBAN) نصوصٌ دائماً لا أرقام.
 */

export interface SnapshotBank {
  id: string;
  beneficiary: string;
  beneficiary_is_seafarer: boolean | null;
  bank: string;
  branch: string;
  country: string;
  iban: string;
  account_number: string;
  swift: string;
  bank_code: string;
  national_id_last4: string;
  authorization: { id: string; beneficiary: string; valid_from: string | null; valid_to: string | null } | null;
}

export interface SnapshotEntry {
  key: string;
  crew_id: string;
  name: string;
  rank: string;
  nationality: string;
  currency: string;
  section: string;
  result: EntryResult;
  differences: Difference[];
  differences_acknowledged: boolean;
  bank: SnapshotBank | null;
  payable: boolean;
  blockers: string[];
}

export interface Snapshot {
  cycle: { id: string; vessel: string; month: string };
  entries: SnapshotEntry[];
  fx: { month: string; per_usd: Record<string, string>; labels: string[] } | null;
  files: { id: string; name: string; kind: string; sha256: string }[];
  decisions: string[];
}

const FORMULA_START = /^[=+\-@\t\r\n]/;

/** نصٌّ آمن: لا يبدأ بما يجعله صيغة. */
export function safeText(v: unknown): string {
  const s = v == null ? '' : String(v);
  return FORMULA_START.test(s) ? `'${s}` : s;
}

type Cell = { t: 's'; v: string } | { t: 'n'; v: number; z?: string };
const S = (v: unknown): Cell => ({ t: 's', v: safeText(v) });
const N = (v: string | number | null | undefined): Cell => (v == null || v === '' ? S('') : { t: 'n', v: Number(v), z: '#,##0.00' });

function sheet(rows: Cell[][], widths?: number[]): XLSX.WorkSheet {
  const ws: XLSX.WorkSheet = {};
  let maxC = 0;
  rows.forEach((r, ri) => {
    r.forEach((c, ci) => { ws[XLSX.utils.encode_cell({ r: ri, c: ci })] = c; });
    maxC = Math.max(maxC, r.length);
  });
  ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(rows.length - 1, 0), c: Math.max(maxC - 1, 0) } });
  if (widths) ws['!cols'] = widths.map((w) => ({ wch: w }));
  return ws;
}

const KIND_AR: Record<string, string> = {
  basic: 'الأساسيّ', fixed_ot: 'الإضافيّ الثابت', leave: 'بدل الإجازة', sign_off_day: 'يوم النزول',
  sign_on_settlement: 'تسوية يوم الصعود', lashing: 'لاشينج', captain_bonus: 'مكافأة القبطان', bonus: 'مكافأة',
  salary_difference: 'فرق مرتّب', luggage: 'أمتعة', other_earning: 'استحقاقٌ آخر', cash_advance: 'سلفة',
  other_deduction: 'خصمٌ آخر', balance: 'الصافي',
};
export const kindLabel = (k: string) => KIND_AR[k] || k;

function write(wb: XLSX.WorkBook): Buffer {
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx', compression: true }) as Buffer;
}

export function buildReviewWorkbook(s: Snapshot, meta: { exported_at: string; status: string; version_no: number | null }): Buffer {
  const wb = XLSX.utils.book_new();
  wb.Workbook = { Views: [{ RTL: true }] };
  const info: Cell[][] = [
    [S('كشف مراجعة مرتّبات الأطقم — للمراجعة لا للصرف')],
    [S('المركب'), S(s.cycle.vessel)], [S('الشهر'), S(s.cycle.month)],
    [S('حالة الدورة'), S(meta.status)], [S('الإصدار'), S(meta.version_no ?? '—')],
    [S('تاريخ التصدير'), S(meta.exported_at)],
    [S('أسعار الصرف'), S(s.fx?.labels.join(' · ') || 'لا سعر مُدخل')],
  ];
  XLSX.utils.book_append_sheet(wb, sheet(info, [22, 60]), 'معلومات');

  const head = ['رقم البحّار', 'الاسم', 'الرتبة', 'القسم', 'العملة', 'بداية الخدمة', 'نهاية الخدمة', 'الأيّام', 'البند', 'اتجاه', 'المبلغ', 'المبلغ الأصليّ', 'العملة الأصليّة', 'السعر', 'المصدر', 'المراجعة', 'داخل الصافي', 'المعادلة أو السبب'];
  const rows: Cell[][] = [head.map(S)];
  for (const e of s.entries) {
    for (const it of e.result.items) {
      rows.push([
        S(e.crew_id), S(e.name), S(e.rank), S(e.section), S(e.currency),
        S(e.result.service.start || ''), S(e.result.service.end || ''), N(e.result.days),
        S(kindLabel(it.kind)), S(it.direction === 'earning' ? 'استحقاق' : 'خصم'),
        N(it.amount), N(it.original_amount), S(it.original_currency),
        S(it.fx_rate ? `1 ${it.original_currency} = ${Number(it.fx_rate).toFixed(6)} ${it.currency}` : ''),
        S(it.source), S(it.review), S(it.counted ? 'نعم' : 'لا'), S(it.formula || it.reason || ''),
      ]);
    }
    rows.push([S(e.crew_id), S(e.name), S(''), S(''), S(e.currency), S(''), S(''), S(''), S('الصافي'), S(''), N(e.result.balance), S(''), S(''), S(''), S(''), S(e.result.complete ? 'مكتمل' : 'غير مكتمل'), S(''), S(e.blockers.join(' · '))]);
  }
  XLSX.utils.book_append_sheet(wb, sheet(rows, [11, 32, 14, 10, 7, 12, 12, 7, 18, 9, 13, 13, 9, 26, 11, 10, 9, 60]), 'البنود');

  const d: Cell[][] = [['رقم البحّار', 'الاسم', 'العملة', 'البند', 'المحسوب', 'المُصدَّر من CFM', 'الفرق', 'أُقِرّ'].map(S)];
  for (const e of s.entries) {
    for (const f of e.differences) {
      d.push([S(e.crew_id), S(e.name), S(e.currency), S(kindLabel(f.kind)), N(f.calculated), N(f.reported), N(f.diff), S(e.differences_acknowledged ? 'نعم' : 'لا')]);
    }
  }
  XLSX.utils.book_append_sheet(wb, sheet(d, [11, 32, 7, 18, 13, 15, 12, 8]), 'الفروق');

  const t: Cell[][] = [['العملة', 'عدد البحّارة', 'المكتمل', 'الاستحقاقات', 'الخصومات', 'الصافي'].map(S)];
  for (const [cur, v] of Object.entries(totals(s.entries))) t.push([S(cur), N(v.count), N(v.complete), N(v.earnings), N(v.deductions), N(v.balance)]);
  XLSX.utils.book_append_sheet(wb, sheet(t, [8, 12, 10, 15, 15, 15]), 'الإجماليّات');
  return write(wb);
}

function totals(entries: SnapshotEntry[]) {
  const out: Record<string, { count: number; complete: number; earnings: number; deductions: number; balance: number }> = {};
  const cents = (x: string) => Math.round(Number(x) * 100);
  for (const e of entries) {
    const t = (out[e.currency] ||= { count: 0, complete: 0, earnings: 0, deductions: 0, balance: 0 });
    t.count++; if (e.result.complete) t.complete++;
    t.earnings += cents(e.result.earnings); t.deductions += cents(e.result.deductions); t.balance += cents(e.result.balance);
  }
  for (const t of Object.values(out)) { t.earnings /= 100; t.deductions /= 100; t.balance /= 100; }
  return out;
}

export interface PaymentsMeta {
  batch_no: string;
  currency: string;
  exported_at: string;
  version_no: number;
  approved_by: string;
  approved_at: string;
}

/** الحالات الداخلة في كشف الصرف: بعملته، ومكتملة، وصافيها موجب. */
export function payableEntries(s: Snapshot, currency: string) {
  const inCur = s.entries.filter((e) => e.currency === currency);
  const included = inCur.filter((e) => e.payable && Number(e.result.balance) > 0);
  const excluded = inCur.filter((e) => !included.includes(e)).map((e) => ({
    entry: e,
    reasons: e.blockers.length ? e.blockers : Number(e.result.balance) <= 0 ? ['الصافي ليس موجباً'] : ['غير مكتمل'],
  }));
  return { included, excluded };
}

export function buildPaymentsWorkbook(s: Snapshot, m: PaymentsMeta): { buffer: Buffer; rows: number; total: string } {
  const { included, excluded } = payableEntries(s, m.currency);
  const wb = XLSX.utils.book_new();
  wb.Workbook = { Views: [{ RTL: true }] };
  const rows: Cell[][] = [
    [S('كشف صرف مرتّبات — من إصدارٍ معتمد · التصدير ليس سداداً')],
    [S('المركب'), S(s.cycle.vessel)], [S('الشهر'), S(s.cycle.month)], [S('العملة'), S(m.currency)],
    [S('رقم الدفعة'), S(m.batch_no)], [S('تاريخ التصدير'), S(m.exported_at)],
    [S('الإصدار المعتمد'), S(m.version_no)], [S('اعتمده'), S(m.approved_by)], [S('تاريخ الاعتماد'), S(m.approved_at)],
    [],
    ['م', 'رقم البحّار', 'الاسم', 'الرتبة', 'المستفيد', 'البنك', 'الفرع', 'الدولة', 'IBAN', 'رقم الحساب', 'SWIFT', 'رمز البنك', 'المبلغ', 'العملة'].map(S),
  ];
  let cents = 0;
  included.forEach((e, i) => {
    const b = e.bank!;
    cents += Math.round(Number(e.result.balance) * 100);
    rows.push([N(i + 1), S(e.crew_id), S(e.name), S(e.rank), S(b.beneficiary), S(b.bank), S(b.branch), S(b.country), S(b.iban), S(b.account_number), S(b.swift), S(b.bank_code), N(e.result.balance), S(m.currency)]);
  });
  const total = (cents / 100).toFixed(2);
  rows.push([S(''), S(''), S('الإجماليّ'), S(''), S(''), S(''), S(''), S(''), S(''), S(''), S(''), S(''), N(total), S(m.currency)]);
  XLSX.utils.book_append_sheet(wb, sheet(rows, [5, 11, 30, 14, 30, 24, 18, 12, 30, 20, 12, 10, 14, 7]), 'الصرف');
  const ex: Cell[][] = [['رقم البحّار', 'الاسم', 'الصافي', 'سبب الاستبعاد'].map(S)];
  for (const x of excluded) ex.push([S(x.entry.crew_id), S(x.entry.name), N(x.entry.result.balance), S(x.reasons.join(' · '))]);
  XLSX.utils.book_append_sheet(wb, sheet(ex, [11, 30, 13, 70]), 'مستبعَد');
  return { buffer: write(wb), rows: included.length, total };
}
