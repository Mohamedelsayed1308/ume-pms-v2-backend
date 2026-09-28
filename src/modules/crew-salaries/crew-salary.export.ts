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
 *   وعضويّة كلّ دفعةٍ صفوفٌ مسجَّلة (`crew_salary_export_rows`) لا لقطة الإصدار كلّها. والحالة
 *   التي خرجت ثمّ تغيّرت لا تُخصم ولا تُعاد آليّاً — تنتظر قرار المالك (انظر `payableEntries`).
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

/** صفٌّ خرج في دفعةٍ سابقة وما زال سارياً (لم يُستبدل بقرار المالك). */
export interface BatchRow {
  id: string;
  batch_no: string;
  version_no: number;
  entry_key: string;
  crew_id: string;
  currency: string;
  amount: string;
  balance: string;
  entry_hash: string;
  bank_id: string | null;
  row_kind: 'full' | 'settlement';
}

/** قرار المالك في حالةٍ خرجت ثمّ تغيّرت — مربوطٌ بآخر صفٍّ خرج لها وبالمحتوى الجديد نفسه. */
export interface BatchResolution {
  id: string;
  row_id: string;
  action: 'replace' | 'settle' | 'keep';
  amount: string | null;
  entry_hash: string;
  reason: string;
  decided_by_name: string;
}

export interface PaymentContext {
  superseded: Map<string, number>;     // حالةٌ حلّ محلّها إصدارٌ أحدث ⇒ رقمه
  rows: BatchRow[];                    // الصفوف السارية التي خرجت فعلاً (لا لقطات الإصدارات)، بترتيب خروجها
  resolutions: BatchResolution[];
  replacedKeys?: Set<string>;          // حالاتٌ أُلغي ما خرج لها بقرار المالك ولا صفّ ساريَ لها
  live?: Set<string>;                  // مفاتيح الحالات الموجودة في الدورة الآن — ما غاب منها «يتيم»
}

export const emptyContext = (): PaymentContext => ({ superseded: new Map(), rows: [], resolutions: [] });

export type HashedEntry = SnapshotEntry & { entry_hash?: string };

export interface PaymentRow {
  entry: HashedEntry;
  kind: 'full' | 'settlement';
  due: string;
  prior: BatchRow[];                   // ما خرج قبلاً لهذه الحالة — للعرض وحده، لا يُطرح
  replaces: string[];                  // صفوفٌ يستبدلها هذا الصفّ بقرار المالك
  resolution: BatchResolution | null;
}

export interface PendingDecision {
  entry: HashedEntry;
  row: BatchRow;                       // آخر ما خرج — القرار يُربط به
  prior: BatchRow[];
  exported: string;
  amount_changed: boolean;
  bank_changed: boolean;
}

const sumRows = (rows: BatchRow[]) => rows.reduce((a, r) => a.plus(r.amount), new Decimal(0)).toFixed(2);
/** ما خرج بعملاته — لا يُجمع مبلغان بعملتين. */
export const priorLabel = (rows: BatchRow[]) => [...new Set(rows.map((r) => r.currency))].map((c) => `${sumRows(rows.filter((r) => r.currency === c))} ${c}`).join(' + ');
const batchesOf = (rows: BatchRow[]) => [...new Set(rows.map((r) => r.batch_no))].join(' و');

/**
 * الحالات الداخلة في الدفعة، والمستبعَدة بأسبابها، والتي تنتظر قرار المالك.
 *
 * لا يُستنتج السداد من التصدير: الحالة التي خرجت ثمّ تغيّرت (مبلغاً أو حساباً) لا تُخصم
 * ولا تُعاد كاملةً آليّاً — تنتظر قراراً موثَّقاً من المالك على آخر صفٍّ خرج لها:
 *   • استبدال: ما خرج سابقاً لم يُنفَّذ ⇒ تُلغى صفوفه، ويخرج الصافي الجديد كاملاً.
 *   • تسوية: ما خرج نُفِّذ ⇒ يخرج مبلغٌ إضافيّ يحدّده المالك صراحةً.
 *   • إبقاء: لا يخرج شيء (ومنه النقص: استرداده خارج هذه الشاشة).
 */
export function payableEntries(s: Snapshot, currency: string, ctx: PaymentContext = emptyContext()) {
  const included: PaymentRow[] = [];
  const excluded: { entry: HashedEntry; reasons: string[]; resolution?: BatchResolution; row?: BatchRow }[] = [];
  const pending: PendingDecision[] = [];
  for (const e of s.entries.filter((x) => x.currency === currency) as HashedEntry[]) {
    const sup = ctx.superseded.get(e.key);
    if (sup) { excluded.push({ entry: e, reasons: [`حلّ محلّها الإصدار ${sup}`] }); continue; }
    if (!e.payable) { excluded.push({ entry: e, reasons: e.blockers.length ? e.blockers : ['غير مكتمل'] }); continue; }
    const own = ctx.rows.filter((r) => r.entry_key === e.key);
    // مفتاح الحالة يحمل عملتها: تغيّرت العملة ⇒ مفتاحٌ جديد. فما خرج للبحّار نفسه تحت مفتاحٍ
    // لم يعد في الدورة يُعدّ خروجاً سابقاً لهذه الحالة — لا تخرج كاملةً كأنّها جديدة
    const orphans = own.length || !ctx.live ? [] : ctx.rows.filter((r) => r.crew_id === e.crew_id && r.entry_key !== e.key && !ctx.live!.has(r.entry_key));
    const prior = own.length ? own : orphans;
    const balance = new Decimal(e.result.balance);
    if (!prior.length) {
      if (ctx.replacedKeys?.has(e.key)) excluded.push({ entry: e, reasons: ['أُلغي ما خرج لها بقرار المالك — لا تخرج تلقائيّاً'] });
      else if (balance.gt(0)) included.push({ entry: e, kind: 'full', due: balance.toFixed(2), prior, replaces: [], resolution: null });
      else excluded.push({ entry: e, reasons: ['الصافي ليس موجباً'] });
      continue;
    }
    const last = prior[prior.length - 1];
    const bankChanged = (last.bank_id || null) !== (e.bank?.id || null);
    if (last.entry_hash === e.entry_hash && !bankChanged) {
      excluded.push({ entry: e, reasons: [`خرجت في ${batchesOf(prior)} — لا جديد`] });
      continue;
    }
    const res = ctx.resolutions.find((r) => r.row_id === last.id && r.entry_hash === e.entry_hash) || null;
    if (!res) {
      const exported = priorLabel(prior);
      pending.push({ entry: e, row: last, prior, exported, amount_changed: !new Decimal(last.balance).eq(balance), bank_changed: bankChanged });
      const what = [orphans.length ? `العملة: ${last.entry_key} ⇐ ${e.key}` : '', bankChanged ? 'الحساب' : ''].filter(Boolean).join('، ');
      excluded.push({ entry: e, reasons: [`خرجت في ${batchesOf(prior)} بمبلغ ${exported} ثمّ تغيّرت${what ? ` (${what})` : ''} — لا يُعرف أنُفِّذت: تنتظر قرار المالك (استبدال · تسوية · إبقاء)`] });
      continue;
    }
    if (res.action === 'keep') { excluded.push({ entry: e, reasons: [`قرار المالك: يبقى ما خرج في ${batchesOf(prior)} دون صرفٍ إضافيّ — ${res.reason}`], resolution: res, row: last }); continue; }
    if (res.action === 'settle') { included.push({ entry: e, kind: 'settlement', due: new Decimal(res.amount!).toFixed(2), prior, replaces: [], resolution: res }); continue; }
    if (!balance.gt(0)) { excluded.push({ entry: e, reasons: ['الصافي ليس موجباً — قرار الاستبدال لا يُخرج شيئاً'] }); continue; }
    included.push({ entry: e, kind: 'full', due: balance.toFixed(2), prior, replaces: prior.map((r) => r.id), resolution: res });
  }
  return { included, excluded, pending };
}

const rowKindLabel = (r: PaymentRow) =>
  r.kind === 'settlement' ? `تسوية إضافيّة بقرار المالك (${r.resolution!.decided_by_name})`
    : r.replaces.length ? `استبدال بقرار المالك — ${batchesOf(r.prior)} لم تُنفَّذ`
      : 'كامل';

export function buildPaymentsWorkbook(s: Snapshot, m: PaymentsMeta, ctx?: PaymentContext) {
  const { included, excluded, pending } = payableEntries(s, m.currency, ctx);
  const wb = XLSX.utils.book_new();
  wb.Workbook = { Views: [{ RTL: true }] };
  const partial = (s.excluded?.length || 0) + (s.already_approved?.length || 0) + excluded.length > 0;
  const rows: Cell[][] = [
    [S('كشف صرف مرتّبات — من إصدارٍ معتمد · التصدير ليس سداداً')],
    [S('المركب'), S(s.cycle.vessel)], [S('الشهر'), S(s.cycle.month)], [S('العملة'), S(m.currency)],
    [S('رقم الدفعة'), S(m.batch_no)], [S('تاريخ التصدير'), S(m.exported_at)],
    [S('الإصدار المعتمد'), S(m.version_no)], [S('اعتمده'), S(m.approved_by)], [S('تاريخ الاعتماد'), S(m.approved_at)],
    [S('النطاق'), S(partial ? 'دفعةٌ جزئيّة — ليست إجماليّ المركب للشهر (انظر ورقة «مستبعَد»)' : 'كلّ حالات الإصدار المكتملة')],
    [],
    ['م', 'رقم البحّار', 'الاسم', 'الرتبة', 'المستفيد', 'البنك', 'الفرع', 'الدولة', 'IBAN', 'رقم الحساب', 'SWIFT', 'رمز البنك', 'الصافي المعتمد', 'خرج سابقاً', 'في دفعة', 'نوع الصفّ', 'في هذه الدفعة', 'العملة'].map(S),
  ];
  let total = new Decimal(0);
  included.forEach((r, i) => {
    const e = r.entry, b = e.bank!;
    total = total.plus(r.due);
    rows.push([N(i + 1), S(e.crew_id), S(e.name), S(e.rank), S(b.beneficiary), S(b.bank), S(b.branch), S(b.country), S(b.iban), S(b.account_number), S(b.swift), S(b.bank_code),
      N(e.result.balance), !r.prior.length ? S('') : r.prior.every((p) => p.currency === m.currency) ? N(sumRows(r.prior)) : S(priorLabel(r.prior)), S(batchesOf(r.prior)), S(rowKindLabel(r)), N(r.due), S(m.currency)]);
  });
  rows.push([S(''), S(''), S('الإجماليّ'), ...Array(13).fill(S('')), N(total.toFixed(2)), S(m.currency)]);
  XLSX.utils.book_append_sheet(wb, sheet(rows, [5, 11, 30, 14, 30, 24, 18, 12, 30, 20, 12, 10, 14, 13, 24, 40, 16, 7]), 'الصرف');
  const ex: Cell[][] = [['رقم البحّار', 'الاسم', 'الصافي', 'سبب الاستبعاد'].map(S)];
  for (const x of excluded) ex.push([S(x.entry.crew_id), S(x.entry.name), N(x.entry.result.balance), S(x.reasons.join(' · '))]);
  for (const x of s.excluded || []) if (x.currency === m.currency) ex.push([S(x.crew_id), S(''), N(x.balance), S(`خارج هذا الإصدار: ${x.reasons.join(' · ')}`)]);
  for (const x of s.already_approved || []) ex.push([S(x.key.split(':')[0]), S(''), S(''), S(`معتمَدة في الإصدار ${x.version_no} دون تغيير`)]);
  XLSX.utils.book_append_sheet(wb, sheet(ex, [11, 30, 13, 90]), 'مستبعَد');
  return { buffer: write(wb), rows: included.length, total: total.toFixed(2), included, pending };
}
