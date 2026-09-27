import * as XLSX from 'xlsx';
import Decimal from 'decimal.js';
import type { Difference, EntryResult } from './crew-salary.calc';
import type { SourceConflict, Unresolved } from './crew-salary.assemble';

/**
 * ملفّا Excel لمرتّبات الأطقم — منطقٌ خالص يأخذ لقطةً ويُعيد ملفّاً.
 *
 * • **كشف المراجعة**: كلّ البنود بمصادرها وفروقها وتعارضاتها وقضاياها المعلّقة — للمراجعة لا للصرف.
 * • **كشف الصرف المعتمد**: من إصدارٍ معتمدٍ وحده، وبعملة دفعٍ واحدة، وللحالات المكتملة وحدها
 *   (حسابٌ معتمد، وتفويضٌ ساري إن كان المستفيد غير البحّار). والتصدير **ليس سداداً**.
 *   والحالة التي صُدِّرت في دفعةٍ سابقة ثمّ عُدِّلت تظهر بمبلغها السابق والفرق، ويُصرف الفرق وحده.
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
  authorization: { id: string; beneficiary: string; valid_from: string | null; valid_to: string | null } | null;
}

export interface SnapshotEntry {
  key: string;
  crew_id: string;
  name: string;
  rank: string;
  nationality: string;
  currency: string;                    // عملة الدفع
  contract_currency: string;
  payment_currency_exception: boolean;
  section: string;
  result: EntryResult;
  differences: Difference[];
  source_conflicts: SourceConflict[];
  differences_acknowledged: boolean;
  bank: SnapshotBank | null;
  payable: boolean;
  blockers: string[];
}

export interface Snapshot {
  cycle: { id: string; vessel: string; month: string };
  entries: SnapshotEntry[];
  fx: { month: string; per_usd: Record<string, string>; labels: string[] } | null;
  // ما لم يدخل هذا الإصدار — ظاهرٌ فلا يُفهم الإجماليّ الجزئيّ إجماليّاً للمركب
  excluded?: { key: string; crew_id: string; currency: string; balance: string; reasons: string[] }[];
  already_approved?: { key: string; version_no: number }[];
  unresolved_open?: number;
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
  other_deduction: 'خصمٌ آخر', unclassified: 'غير مصنَّف', balance: 'الصافي',
};
export const kindLabel = (k: string) => KIND_AR[k] || k;

/** ثابتٌ عبر التنزيلات: لا تاريخ تعديلٍ داخل الملفّ يختلف بين نسختين من المحتوى نفسه. */
function write(wb: XLSX.WorkBook): Buffer {
  wb.Props = { Title: 'UME crew salaries', CreatedDate: new Date(Date.UTC(2000, 0, 1)) };
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx', compression: true }) as Buffer;
}

export function buildReviewWorkbook(s: Snapshot, meta: { exported_at: string; status: string; version_no: number | null; unresolved: Unresolved[] }): Buffer {
  const wb = XLSX.utils.book_new();
  wb.Workbook = { Views: [{ RTL: true }] };
  const info: Cell[][] = [
    [S('كشف مراجعة مرتّبات الأطقم — للمراجعة لا للصرف')],
    [S('المركب'), S(s.cycle.vessel)], [S('الشهر'), S(s.cycle.month)],
    [S('حالة الدورة'), S(meta.status)], [S('آخر إصدار'), S(meta.version_no ?? '—')],
    [S('تاريخ التصدير'), S(meta.exported_at)],
    [S('أسعار الصرف'), S(s.fx?.labels.join(' · ') || 'لا تحويل في الدورة')],
    [S('قضايا معلّقة'), N(meta.unresolved.filter((u) => !u.resolution).length)],
  ];
  XLSX.utils.book_append_sheet(wb, sheet(info, [22, 60]), 'معلومات');

  const head = ['رقم البحّار', 'الاسم', 'الرتبة', 'القسم', 'عملة العقد', 'عملة الدفع', 'بداية الخدمة', 'نهاية الخدمة', 'الأيّام', 'البند', 'اتجاه', 'المبلغ', 'المبلغ الأصليّ', 'العملة الأصليّة', 'السعر', 'المصدر', 'المراجعة', 'داخل الصافي', 'المعادلة أو السبب'];
  const rows: Cell[][] = [head.map(S)];
  for (const e of s.entries) {
    for (const it of e.result.items) {
      rows.push([
        S(e.crew_id), S(e.name), S(e.rank), S(e.section), S(e.contract_currency), S(e.currency),
        S(e.result.service.start || ''), S(e.result.service.end || ''), N(e.result.days),
        S(kindLabel(it.kind)), S(it.direction === 'earning' ? 'استحقاق' : 'خصم'),
        N(it.amount), S(it.original_amount), S(it.original_currency),
        S(it.fx_rate ? `1 ${it.original_currency} = ${new Decimal(it.fx_rate).toFixed(6)} ${it.currency}` : ''),
        S(it.source), S(it.review), S(it.counted ? 'نعم' : 'لا'), S(it.formula || it.reason || ''),
      ]);
    }
    rows.push([S(e.crew_id), S(e.name), S(''), S(''), S(e.contract_currency), S(e.currency), S(''), S(''), S(''), S('الصافي'), S(''), N(e.result.balance), S(''), S(''), S(''), S(''), S(e.result.complete ? 'مكتمل' : 'غير مكتمل'), S(''), S(e.blockers.join(' · '))]);
  }
  XLSX.utils.book_append_sheet(wb, sheet(rows, [11, 32, 14, 10, 8, 8, 12, 12, 7, 18, 9, 13, 13, 9, 26, 11, 10, 9, 60]), 'البنود');

  const d: Cell[][] = [['رقم البحّار', 'الاسم', 'العملة', 'البند', 'المحسوب', 'المقابل', 'الفرق', 'المصدر', 'أُقِرّ'].map(S)];
  for (const e of s.entries) {
    for (const f of e.differences) d.push([S(e.crew_id), S(e.name), S(e.contract_currency), S(kindLabel(f.kind)), N(f.calculated), N(f.reported), f.diff == null ? S('غير قابل للمقارنة') : N(f.diff), S('CFM'), S(e.differences_acknowledged ? 'نعم' : 'لا')]);
    for (const c of e.source_conflicts) d.push([S(e.crew_id), S(e.name), S(c.currency), S(kindLabel(c.kind)), N(c.email), N(c.other), c.email == null ? S('') : N(new Decimal(c.email).minus(c.other).toFixed(2)), S(c.source), S(e.differences_acknowledged ? 'نعم' : 'لا')]);
  }
  XLSX.utils.book_append_sheet(wb, sheet(d, [11, 32, 7, 18, 13, 15, 12, 30, 8]), 'الفروق والتعارضات');

  const u: Cell[][] = [['المفتاح', 'النوع', 'التفصيل', 'المبالغ', 'الحسم', 'السبب'].map(S)];
  for (const x of meta.unresolved) {
    u.push([S(x.key), S(x.kind), S(x.detail), S((x.amounts || []).map((a) => `${a.column}: ${a.amount} ${a.currency || '؟'}`).join(' · ')), S(x.resolution?.action || 'معلّق'), S(x.resolution?.reason || '')]);
  }
  XLSX.utils.book_append_sheet(wb, sheet(u, [26, 20, 60, 30, 10, 40]), 'قضايا المصدر');

  const t: Cell[][] = [['عملة الدفع', 'عدد الحالات', 'المكتمل', 'الاستحقاقات', 'الخصومات', 'الصافي'].map(S)];
  for (const [cur, v] of Object.entries(totals(s.entries))) t.push([S(cur), N(v.count), N(v.complete), N(v.earnings), N(v.deductions), N(v.balance)]);
  XLSX.utils.book_append_sheet(wb, sheet(t, [10, 12, 10, 15, 15, 15]), 'الإجماليّات');
  return write(wb);
}

function totals(entries: SnapshotEntry[]) {
  const out: Record<string, { count: number; complete: number; earnings: string; deductions: string; balance: string }> = {};
  const acc: Record<string, { count: number; complete: number; e: Decimal; d: Decimal }> = {};
  for (const e of entries) {
    const t = (acc[e.currency] ||= { count: 0, complete: 0, e: new Decimal(0), d: new Decimal(0) });
    t.count++; if (e.result.complete) t.complete++;
    t.e = t.e.plus(e.result.earnings); t.d = t.d.plus(e.result.deductions);
  }
  for (const [c, t] of Object.entries(acc)) out[c] = { count: t.count, complete: t.complete, earnings: t.e.toFixed(2), deductions: t.d.toFixed(2), balance: t.e.minus(t.d).toFixed(2) };
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

export interface PaymentContext {
  superseded: Map<string, number>;                                  // حالةٌ حلّ محلّها إصدارٌ أحدث ⇒ رقمه
  previous: Map<string, { batch: string; amount: string; version_no: number }>; // حالةٌ صُدِّرت قبلاً
}

export interface PaymentRow { entry: SnapshotEntry; previous: { batch: string; amount: string; version_no: number } | null; due: string }

/** الحالات الداخلة في كشف الصرف، والمستبعَدة بأسبابها. */
export function payableEntries(s: Snapshot, currency: string, ctx: PaymentContext = { superseded: new Map(), previous: new Map() }) {
  const inCur = s.entries.filter((e) => e.currency === currency);
  const included: PaymentRow[] = [];
  const excluded: { entry: SnapshotEntry; reasons: string[] }[] = [];
  for (const e of inCur) {
    const sup = ctx.superseded.get(e.key);
    if (sup) { excluded.push({ entry: e, reasons: [`حلّ محلّها الإصدار ${sup}`] }); continue; }
    if (!e.payable) { excluded.push({ entry: e, reasons: e.blockers.length ? e.blockers : ['غير مكتمل'] }); continue; }
    const prev = ctx.previous.get(e.key) || null;
    const due = new Decimal(e.result.balance).minus(prev?.amount ?? 0);
    if (due.lte(0)) {
      excluded.push({ entry: e, reasons: [prev ? `صُدِّرت في ${prev.batch} بمبلغ ${prev.amount} — لا زيادة للصرف${due.lt(0) ? ` (زيادةٌ مصروفة ${due.abs().toFixed(2)} تُسترَدّ يدويّاً)` : ''}` : 'الصافي ليس موجباً'] });
      continue;
    }
    included.push({ entry: e, previous: prev, due: due.toFixed(2) });
  }
  return { included, excluded };
}

export function buildPaymentsWorkbook(s: Snapshot, m: PaymentsMeta, ctx?: PaymentContext): { buffer: Buffer; rows: number; total: string } {
  const { included, excluded } = payableEntries(s, m.currency, ctx);
  const wb = XLSX.utils.book_new();
  wb.Workbook = { Views: [{ RTL: true }] };
  const partial = (s.excluded?.length || 0) + (s.already_approved?.length || 0) > 0;
  const rows: Cell[][] = [
    [S('كشف صرف مرتّبات — من إصدارٍ معتمد · التصدير ليس سداداً')],
    [S('المركب'), S(s.cycle.vessel)], [S('الشهر'), S(s.cycle.month)], [S('العملة'), S(m.currency)],
    [S('رقم الدفعة'), S(m.batch_no)], [S('تاريخ التصدير'), S(m.exported_at)],
    [S('الإصدار المعتمد'), S(m.version_no)], [S('اعتمده'), S(m.approved_by)], [S('تاريخ الاعتماد'), S(m.approved_at)],
    [S('النطاق'), S(partial ? 'دفعةٌ جزئيّة — ليست إجماليّ المركب للشهر (انظر ورقة «مستبعَد»)' : 'كلّ حالات الدورة المكتملة')],
    [],
    ['م', 'رقم البحّار', 'الاسم', 'الرتبة', 'المستفيد', 'البنك', 'الفرع', 'الدولة', 'IBAN', 'رقم الحساب', 'SWIFT', 'رمز البنك', 'الصافي المعتمد', 'صُدِّر سابقاً', 'في دفعة', 'المستحقّ في هذه الدفعة', 'العملة'].map(S),
  ];
  let total = new Decimal(0);
  included.forEach((r, i) => {
    const e = r.entry, b = e.bank!;
    total = total.plus(r.due);
    rows.push([N(i + 1), S(e.crew_id), S(e.name), S(e.rank), S(b.beneficiary), S(b.bank), S(b.branch), S(b.country), S(b.iban), S(b.account_number), S(b.swift), S(b.bank_code),
      N(e.result.balance), r.previous ? N(r.previous.amount) : S(''), S(r.previous?.batch || ''), N(r.due), S(m.currency)]);
  });
  rows.push([S(''), S(''), S('الإجماليّ'), ...Array(12).fill(S('')), N(total.toFixed(2)), S(m.currency)]);
  XLSX.utils.book_append_sheet(wb, sheet(rows, [5, 11, 30, 14, 30, 24, 18, 12, 30, 20, 12, 10, 14, 13, 24, 16, 7]), 'الصرف');
  const ex: Cell[][] = [['رقم البحّار', 'الاسم', 'الصافي', 'سبب الاستبعاد'].map(S)];
  for (const x of excluded) ex.push([S(x.entry.crew_id), S(x.entry.name), N(x.entry.result.balance), S(x.reasons.join(' · '))]);
  for (const x of s.excluded || []) if (x.currency === m.currency) ex.push([S(x.crew_id), S(''), N(x.balance), S(`خارج هذا الإصدار: ${x.reasons.join(' · ')}`)]);
  for (const x of s.already_approved || []) ex.push([S(x.key.split(':')[0]), S(''), S(''), S(`معتمَدة في الإصدار ${x.version_no} دون تغيير`)]);
  XLSX.utils.book_append_sheet(wb, sheet(ex, [11, 30, 13, 70]), 'مستبعَد');
  return { buffer: write(wb), rows: included.length, total: total.toFixed(2) };
}
