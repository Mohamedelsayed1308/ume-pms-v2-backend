import Decimal from 'decimal.js';
import {
  computeEntry, compareWithReported, COMPARE_GROUP, money, monthBounds,
  type Difference, type EntryInput, type EntryResult, type ExtraItemInput, type FxMonth, type ItemFlag, type ItemKind, type ReportedItem,
} from './crew-salary.calc';
import { matchName, sourceKey, type Candidate, type MatchResult } from './crew-salary.match';
import type { CfmExport, CfmSeafarer, CfmSummaryRow, Provenance } from './parsers/cfm.parser';
import type { EmailNote, EmailRow, ParsedEmailBody } from './parsers/email-body.parser';
import type { BankBlock, CrewListRow, PayoutRow } from './parsers/attachments.parser';
import type { LashingRow } from './parsers/pdf.parser';

/**
 * تجميع دورة شهرٍ لمركب من مصادرها — منطقٌ خالص.
 *
 * • **CFM**: من في الكشف، وعملة عقده، وتاريخا خدمته، ومرتّباته الشهريّة، وما صدّره من مبالغ
 *   (للمقارنة وحدها — لا يدخل منها بندٌ في الحساب إلّا السلفة عند غياب مصدرها الأصليّ).
 * • **الرسالة**: البنود الإضافيّة (لاشينج، مكافأة، أمتعة، فرق مرتّب، يوما النزول والصعود).
 * • **كشف الصرف**: السلف باليورو وبنوك المصريّين وتاريخا الرفت والتعيين.
 * • **كشف البنوك**: حسابات الأجانب. • **PDF توزيع اللاشينج**: مرجعٌ للمقارنة لا يحلّ محلّ الرسالة.
 *
 * ── لا بيانات ماليّة تسقط بصمت ──
 * كلّ ما لم يُحسم (صفٌّ بلا رقم بحّار، عمودٌ مجهول، ملاحظةٌ بمبلغ، ملفٌّ لم يُقرأ، انقطاعٌ في جدول)
 * يظهر في `unresolved` بمصدره، ولا يُعدّ محسوماً إلّا بربطٍ أو تصحيحٍ أو استبعادٍ مسبَّب.
 * وكلّ بندٍ مستورَد يبدأ «معلّقاً» حتّى يراجعه إنسان.
 */

export interface Resolution { action: 'excluded' | 'resolved'; reason: string }
export interface SupplementaryInput {
  source_key: string;           // مفتاح الملاحظة أو المصدر: email:note:p9
  crew_id: string; name: string; currency: string; amount: string; kind: ItemKind; reason: string;
}

export interface Sources {
  month: string;
  vessel: string;
  cfm: CfmExport[];
  email?: ParsedEmailBody | null;
  email_file?: string;
  payout?: PayoutRow[];
  bank_blocks?: BankBlock[];
  crew_list?: CrewListRow[];
  lashing_pdf?: { file: string; rows: LashingRow[] } | null;
  links?: Map<string, string>;                         // مفتاح الاسم ⇒ رقم البحّار (مؤكَّد)
  reviews?: Record<string, 'accepted' | 'rejected'>;   // مفتاح البند ⇒ قرار المراجعة
  classify?: Record<string, ItemKind>;                 // مفتاح بندٍ مجهول ⇒ نوعه بعد التصنيف
  item_currency?: Record<string, string>;              // مفتاح بند ⇒ عملته المؤكَّدة
  resolutions?: Record<string, Resolution>;            // مفتاح قضيّةٍ معلّقة ⇒ حسمها
  manual?: { entry_key: string; item: ExtraItemInput }[];
  supplementary?: SupplementaryInput[];
  payment_currency?: Record<string, string>;           // مفتاح الحالة ⇒ عملة دفعٍ استثنائيّة
  file_issues?: { key: string; name: string; detail: string }[];
}

export interface BankCandidate {
  source: 'cfm_sheet' | 'payout_sheet' | 'bank_sheet';
  beneficiary: string;
  bank: string;
  branch: string;
  country: string;
  iban: string;
  account_number: string;
  swift: string;
  bank_code: string;
  account_currency: string | null;
  provenance: Provenance;
}

export interface DateCheck { field: 'pay_start' | 'pay_end'; cfm: string | null; other: string; source: string; provenance: Provenance }
export interface SourceConflict { kind: ItemKind; email: string | null; other: string; currency: string; source: string; provenance: Provenance }

export interface AssembledEntry {
  key: string;                                         // crew_id:عملة العقد
  crew_id: string;
  name: string;
  rank: string;
  nationality: string;
  currency: string;                                    // عملة العقد
  payment_currency: string;
  payment_currency_exception: boolean;
  section: 'monthly' | 'final' | 'supplementary';
  input: EntryInput;
  result: EntryResult;
  reported: ReportedItem[];
  reported_balance: string | null;
  differences: Difference[];
  source_conflicts: SourceConflict[];
  provenance: Provenance[];
  payout_match: (MatchResult & { row: number; name: string }) | null;
  bank_match: (MatchResult & { row: number; name: string }) | null;
  bank_candidates: BankCandidate[];
  date_checks: DateCheck[];
}

export type UnresolvedKind = 'email_row_no_id' | 'email_row_unknown_currency' | 'parse_issue' | 'note' | 'file';
export interface Unresolved {
  key: string;
  kind: UnresolvedKind;
  detail: string;
  name?: string;
  amounts?: { column: string; amount: string; currency: string | null }[];
  candidates?: { crew_id: string; score: number }[];
  source: { file?: string; table?: number; row?: number; paragraph?: number };
  resolution: Resolution | null;
}

export interface Unmatched {
  payout: { row: PayoutRow; match: MatchResult }[];
  bank_blocks: { row: BankBlock; match: MatchResult }[];
  lashing_pdf: { row: LashingRow; match: MatchResult }[];
}

export interface Assembled {
  month: string;
  vessel: string;
  entries: AssembledEntry[];
  unresolved: Unresolved[];
  unmatched: Unmatched;
  notes: EmailNote[];
  warnings: string[];
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40) || 'col';
const groupOf = (k: ItemKind): ItemKind => COMPARE_GROUP[k] || k;
const same = (a: string | null | undefined, b: string | null | undefined) => a != null && b != null && new Decimal(a).eq(b);

export const noteKey = (n: EmailNote) => `email:note:p${n.paragraph}`;
export const rowKey = (r: EmailRow) => `email:t${r.table}:r${r.row}`;

export function assemble(src: Sources, fx: FxMonth | null): Assembled {
  const warnings: string[] = [];
  const reviews = src.reviews || {};
  const classify = src.classify || {};
  const curOverride = src.item_currency || {};
  const resolutions = src.resolutions || {};
  const unresolved: Unresolved[] = [];
  const decide = (key: string): ExtraItemInput['review'] => reviews[key] || 'pending';

  // ── المرشّحون للمطابقة بالاسم: أسماء CFM وأسماء قائمة الطاقم لكلّ رقم ──
  const cand = new Map<string, Candidate>();
  const addName = (id: string, name: string, rank?: string) => {
    if (!name) return;
    const c = cand.get(id) || { crew_id: id, names: [], rank };
    if (!c.names.includes(name)) c.names.push(name);
    cand.set(id, c);
  };
  for (const x of src.cfm) {
    for (const r of x.rows) addName(r.crew_id, r.name, r.rank);
    for (const s of x.seafarers) { addName(s.crew_id, s.full_name, s.rank); if (s.bank?.beneficiary) addName(s.crew_id, s.bank.beneficiary); }
  }
  for (const r of src.crew_list || []) if (cand.has(r.crew_id)) addName(r.crew_id, r.name, r.rank);
  const candidates = [...cand.values()];
  const linked = (m: MatchResult) => (m.status === 'confirmed' || m.status === 'exact' ? m.crew_id : null);

  const payoutBy = new Map<string, { row: PayoutRow; match: MatchResult }>();
  const unmatchedPayout: Unmatched['payout'] = [];
  for (const row of src.payout || []) {
    const match = matchName(row.name, candidates, src.links);
    const id = linked(match);
    if (id && !payoutBy.has(id)) payoutBy.set(id, { row, match });
    else unmatchedPayout.push({ row, match });
  }
  const bankBy = new Map<string, { row: BankBlock; match: MatchResult }>();
  const unmatchedBank: Unmatched['bank_blocks'] = [];
  for (const row of src.bank_blocks || []) {
    const match = matchName(row.beneficiary || row.name, candidates, src.links);
    const best = linked(match) ? match : matchName(row.name, candidates, src.links);
    const id = linked(best);
    if (id && !bankBy.has(id)) bankBy.set(id, { row, match: best });
    else unmatchedBank.push({ row, match: best });
  }
  const lashBy = new Map<string, LashingRow>();
  const unmatchedLash: Unmatched['lashing_pdf'] = [];
  for (const row of src.lashing_pdf?.rows || []) {
    const match = matchName(row.name, candidates, src.links);
    const id = linked(match);
    if (id && !lashBy.has(id)) lashBy.set(id, row);
    else if (Number(row.eur) > 0) unmatchedLash.push({ row, match });
  }

  // ── صفوف الرسالة: برقم البحّار، أو بربطٍ مؤكَّد لاسمه — وإلّا قضيّةٌ معلّقة ──
  const emailBy = new Map<string, EmailRow[]>();
  const tableCur = new Map<number, string | null>((src.email?.tables || []).map((t) => [t.index, t.currency]));
  for (const t of src.email?.tables || []) {
    for (const r of t.rows) {
      const id = r.crew_id || src.links?.get(sourceKey(r.name)) || null;
      const hasMoney = r.items.length + r.unknown.length + r.unreadable.length > 0;
      if (id) { emailBy.set(id, [...(emailBy.get(id) || []), { ...r, crew_id: id }]); continue; }
      if (!hasMoney && !r.name) continue;
      const m = matchName(r.name, candidates, src.links);
      unresolved.push({
        key: rowKey(r), kind: 'email_row_no_id', name: r.name,
        detail: `صفٌّ في الجدول ${r.table} بلا رقم بحّار: ${r.name || '—'} — اربطه بالبحّار أو استبعده بسبب`,
        amounts: [...r.items.map((i) => ({ column: i.column, amount: i.amount, currency: tableCur.get(r.table) ?? null })),
          ...r.unknown.map((u) => ({ column: u.column, amount: u.value, currency: tableCur.get(r.table) ?? null }))],
        candidates: m.candidates, source: { file: src.email_file, table: r.table, row: r.row },
        resolution: resolutions[rowKey(r)] || null,
      });
    }
  }
  for (const i of src.email?.issues || []) {
    unresolved.push({ key: i.key, kind: 'parse_issue', detail: i.detail, source: { file: src.email_file, table: i.table, row: i.row }, resolution: resolutions[i.key] || null });
  }
  for (const f of src.file_issues || []) {
    unresolved.push({ key: f.key, kind: 'file', detail: f.detail, source: { file: f.name }, resolution: resolutions[f.key] || null });
  }

  const entries: AssembledEntry[] = [];
  const b = monthBounds(src.month);
  const inCfm = new Set<string>();

  for (const x of src.cfm) {
    if (x.month && x.month !== src.month) warnings.push(`تصدير CFM بعملة ${x.currency} لشهر ${x.month} لا ${src.month}`);
    const sheetBy = new Map<string, CfmSeafarer>(x.seafarers.map((s) => [s.crew_id, s]));
    for (const row of x.rows) {
      const sheet = sheetBy.get(row.crew_id) || null;
      if (!sheet) warnings.push(`البحّار ${row.crew_id} بلا ورقة تفصيليّة في تصدير ${x.currency} — مرتّبه الشهريّ غير معروف`);
      inCfm.add(row.crew_id);
      entries.push(buildEntry(src, x, row, sheet, emailBy.get(row.crew_id) || [], tableCur, payoutBy.get(row.crew_id), bankBy.get(row.crew_id), lashBy.get(row.crew_id), decide, classify, curOverride, fx, b));
    }
  }

  // ── بحّارةٌ في الرسالة لا في CFM: استحقاقٌ تكميليّ بلا مرتّب — حالةٌ لكلّ عملة ──
  for (const [id, rows] of emailBy) {
    if (inCfm.has(id)) continue;
    const byCur = new Map<string, ExtraItemInput[]>();
    for (const r of rows) {
      const tc = tableCur.get(r.table) || null;
      const items = rowExtras(r, '', decide, classify, curOverride, tc);
      for (const it of items) {
        if (!it.currency) {
          unresolved.push({
            key: `${it.key}:currency`, kind: 'email_row_unknown_currency', name: r.name,
            detail: `بندٌ للبحّار ${id} في جدولٍ بلا عملة، والبحّار خارج CFM — حدّد عملته`,
            amounts: [{ column: it.reason || it.kind, amount: it.amount, currency: null }],
            source: { file: src.email_file, table: r.table, row: r.row }, resolution: resolutions[`${it.key}:currency`] || null,
          });
          continue;
        }
        byCur.set(it.currency, [...(byCur.get(it.currency) || []), it]);
      }
    }
    for (const [cur, extras] of byCur) {
      entries.push(supplementaryEntry(src, id, rows[0].name, rows[0].rank, rows[0].nationality, cur, extras,
        rows.map((r) => ({ file: src.email_file, sheet: `email-table-${r.table}`, row: r.row })), fx));
    }
  }

  // ── ملاحظات الرسالة: مستحقٌّ تكميليّ بعد ربطها ببحّارٍ مؤكَّد، أو استبعادٌ مسبَّب ──
  const suppByNote = new Map((src.supplementary || []).map((s) => [s.source_key, s]));
  for (const n of src.email?.notes || []) {
    const k = noteKey(n);
    const s = suppByNote.get(k);
    unresolved.push({
      key: k, kind: 'note', detail: n.text, amounts: n.amount ? [{ column: 'note', amount: n.amount, currency: n.currency }] : [],
      source: { file: src.email_file, paragraph: n.paragraph },
      resolution: s ? { action: 'resolved', reason: `مستحقٌّ تكميليّ للبحّار ${s.crew_id}: ${s.reason}` } : resolutions[k] || null,
    });
  }
  for (const s of src.supplementary || []) {
    const item: ExtraItemInput = { key: `supp:${s.source_key}`, kind: s.kind, amount: s.amount, currency: s.currency, reason: s.reason, source: 'email-note', review: decide(`supp:${s.source_key}`), flags: ['manually_identified'] };
    const host = entries.find((e) => e.crew_id === s.crew_id && e.currency === s.currency);
    if (host) { host.input.extras.push(item); recompute(host, fx); continue; }
    entries.push(supplementaryEntry(src, s.crew_id, s.name, '', '', s.currency, [item], [{ file: src.email_file, sheet: 'email-note', row: 0 }], fx));
  }

  for (const m of src.manual || []) {
    const e = entries.find((x) => x.key === m.entry_key);
    if (!e) { warnings.push(`بندٌ يدويّ لحالةٍ غير موجودة في الدورة: ${m.entry_key}`); continue; }
    e.input.extras.push({ ...m.item, review: reviews[m.item.key] || m.item.review });
    recompute(e, fx);
  }

  // عملة الدفع الاستثنائيّة — قرارٌ مسبَّب لكلّ حالة
  for (const e of entries) {
    const pc = src.payment_currency?.[e.key];
    if (pc && pc !== e.currency) {
      e.payment_currency = pc; e.payment_currency_exception = true;
      e.input.paymentCurrency = pc;
      recompute(e, fx);
    }
  }

  return {
    month: src.month, vessel: src.vessel, entries, unresolved,
    unmatched: { payout: unmatchedPayout, bank_blocks: unmatchedBank, lashing_pdf: unmatchedLash },
    notes: src.email?.notes || [], warnings,
  };
}

export function recompute(e: AssembledEntry, fx: FxMonth | null) {
  e.result = computeEntry(e.input, fx);
  e.differences = compareWithReported(e.result, e.reported, e.reported_balance);
}

/** بنود صفٍّ من الرسالة — بعملة جدوله، أو عملة العقد مع علامة «مستنتَجة»، أو بلا عملة. */
function rowExtras(r: EmailRow, fallbackCur: string, decide: (k: string) => ExtraItemInput['review'],
  classify: Record<string, ItemKind>, curOverride: Record<string, string>, tableCur?: string | null): ExtraItemInput[] {
  const base = `email:t${r.table}:r${r.row}`;
  const out: ExtraItemInput[] = [];
  const make = (key: string, kind: ItemKind, amount: string, reason: string, flags: ItemFlag[]): ExtraItemInput => {
    const confirmed = curOverride[key];
    const cur = confirmed || tableCur || fallbackCur;
    const f = [...flags];
    if (!confirmed && !tableCur && cur) f.push('currency_inferred');
    const k = classify[key] || kind;
    return {
      key, kind: k, amount, currency: cur, reason, source: 'email', flags: f.length ? f : undefined,
      // التصنيف قرار مراجعة: يُقبل البند بتصنيفه ما لم يُرفض صراحة
      review: classify[key] && decide(key) === 'pending' ? 'accepted' : decide(key),
    };
  };
  for (const it of r.items) out.push(make(`${base}:${it.kind}`, it.kind, it.amount, [it.column, r.statement].filter(Boolean).join(' — '), []));
  for (const u of r.unreadable) out.push(make(`${base}:${u.kind}`, u.kind, u.value, `${u.column}: «${u.value}»`, ['unreadable_amount']));
  for (const u of r.unknown) out.push(make(`${base}:x:${slug(u.column)}`, 'unclassified', money(u.value) ?? u.value, `${u.column}: ${u.value}`, ['unknown_column']));
  return out;
}

function supplementaryEntry(src: Sources, id: string, name: string, rank: string, nationality: string, cur: string,
  extras: ExtraItemInput[], provenance: Provenance[], fx: FxMonth | null): AssembledEntry {
  const input: EntryInput = { month: src.month, currency: cur, payStart: null, payEnd: null, signsOffThisMonth: false, rates: null, extras };
  const result = computeEntry(input, fx);
  return {
    key: `${id}:${cur}`, crew_id: id, name, rank, nationality, currency: cur, payment_currency: cur, payment_currency_exception: false,
    section: 'supplementary', input, result, reported: [], reported_balance: null, differences: [], source_conflicts: [],
    provenance, payout_match: null, bank_match: null, bank_candidates: [], date_checks: [],
  };
}

function buildEntry(
  src: Sources, x: CfmExport, row: CfmSummaryRow, sheet: CfmSeafarer | null, emailRows: EmailRow[],
  tableCur: Map<number, string | null>, payout: { row: PayoutRow; match: MatchResult } | undefined,
  bank: { row: BankBlock; match: MatchResult } | undefined, lash: LashingRow | undefined,
  decide: (k: string) => ExtraItemInput['review'], classify: Record<string, ItemKind>, curOverride: Record<string, string>,
  fx: FxMonth | null, b: { start: string; end: string },
): AssembledEntry {
  const cur = x.currency;
  const extras: ExtraItemInput[] = [];
  for (const r of emailRows) extras.push(...rowExtras(r, cur, decide, classify, curOverride, tableCur.get(r.table) || null));

  // السلف: من كشف الصرف بعملتها الأصليّة إن رُبط الصفّ، وإلّا من CFM كما صدّرها
  const p = payout?.row;
  if (p?.cash_advance_eur) {
    const key = `payout:r${p.provenance.row}:cash_advance`;
    extras.push({ key, kind: 'cash_advance', amount: p.cash_advance_eur, currency: 'EUR', reason: 'Cash Advance in Euro — كشف الصرف', source: 'attachment', review: decide(key) });
  } else if (sheet) {
    for (const it of sheet.items.filter((i) => i.kind === 'cash_advance')) {
      const key = `cfm:${sheet.sheet}:r${it.provenance.row}:cash_advance`;
      extras.push({ key, kind: 'cash_advance', amount: it.amount, currency: cur, reason: 'سلفة كما صدّرها CFM (لا مصدر أصليّ مربوط)', source: 'cfm', review: decide(key) });
    }
  }
  if (p?.cigarettes_usd) {
    const key = `payout:r${p.provenance.row}:cigarettes`;
    extras.push({ key, kind: 'other_deduction', amount: p.cigarettes_usd, currency: 'USD', reason: 'Cigarettes — كشف الصرف', source: 'attachment', review: decide(key) });
  }
  for (const [field, kind, label] of [['other_addition', 'other_earning', 'Other Addition'], ['bonus', 'bonus', 'Bonus'], ['other_deduction', 'other_deduction', 'Other Deduct']] as const) {
    const v = p?.[field];
    if (!v) continue;
    const key = `payout:r${p!.provenance.row}:${field}`;
    const confirmed = curOverride[key];
    const item: ExtraItemInput = {
      key, kind, amount: v, currency: confirmed || p!.account_currency || cur, reason: `${label} — كشف الصرف`,
      source: 'attachment', review: decide(key), flags: confirmed ? undefined : ['currency_inferred'],
    };
    // المبلغ نفسه في الرسالة ⇒ مكرّرٌ محتمل: لا يُقبل جماعيّاً، وقبول الاثنين مانع
    const twin = extras.find((e) => e.source === 'email' && groupOf(e.kind) === groupOf(kind) && same(money(e.amount), v));
    if (twin) { item.duplicate_of = twin.key; item.flags = [...(item.flags || []), 'possible_duplicate']; }
    extras.push(item);
  }

  const rates = sheet && sheet.rates.basic && sheet.rates.fixed_ot && sheet.rates.leave
    ? { basic: sheet.rates.basic, fixed_ot: sheet.rates.fixed_ot, leave: sheet.rates.leave }
    : { basic: '', fixed_ot: '', leave: '' };
  const input: EntryInput = {
    month: src.month, currency: cur, payStart: row.pay_start, payEnd: row.pay_end,
    // قسم «الحساب النهائيّ» = نزولٌ هذا الشهر. وشرط «قبل آخر يوم» في المحرّك نفسه
    signsOffThisMonth: row.section === 'final', rates, extras,
  };
  const result = computeEntry(input, fx);
  const reported: ReportedItem[] = (sheet?.items || []).map((i) => ({ kind: i.kind, amount: i.amount, description: i.description }));
  const reported_balance = sheet?.balance ?? row.balance;

  const date_checks: DateCheck[] = [];
  if (p) {
    const inMonth = (d: string | null) => !!d && d >= b.start && d <= b.end;
    if (inMonth(p.sign_on) && p.sign_on !== row.pay_start) date_checks.push({ field: 'pay_start', cfm: row.pay_start, other: p.sign_on!, source: 'كشف الصرف (التعيين)', provenance: p.provenance });
    if (inMonth(p.sign_off) && p.sign_off !== row.pay_end) date_checks.push({ field: 'pay_end', cfm: row.pay_end, other: p.sign_off!, source: 'كشف الصرف (الرفت)', provenance: p.provenance });
  }

  // اللاشينج: الرسالة هي المصدر، وPDF التوزيع مرجعٌ يُظهر التعارض ولا يستبدل
  const source_conflicts: SourceConflict[] = [];
  if (lash && src.lashing_pdf) {
    const pdfAmount = cur === 'USD' && lash.usd && Number(lash.usd) > 0 ? lash.usd : lash.eur_pay && Number(lash.eur_pay) > 0 ? lash.eur_pay : null;
    const pdfCur = cur === 'USD' && lash.usd && Number(lash.usd) > 0 ? 'USD' : 'EUR';
    const emailLash = extras.filter((e) => e.source === 'email' && groupOf(e.kind) === 'bonus' && e.kind !== 'captain_bonus');
    const emailSum = emailLash.length ? emailLash.reduce((a, e) => a.plus(money(e.amount) ?? 0), new Decimal(0)).toFixed(2) : null;
    if (pdfAmount && !same(emailSum, pdfAmount)) {
      source_conflicts.push({
        kind: 'lashing', email: emailSum, other: new Decimal(pdfAmount).toFixed(2), currency: pdfCur,
        source: `PDF توزيع اللاشينج «${src.lashing_pdf.file}»`, provenance: { file: src.lashing_pdf.file, sheet: `page-${lash.page}`, row: lash.line },
      });
    }
  }

  const bank_candidates: BankCandidate[] = [];
  if (sheet?.bank) {
    const k = sheet.bank;
    bank_candidates.push({ source: 'cfm_sheet', beneficiary: k.beneficiary, bank: k.bank, branch: '', country: '', iban: k.iban, account_number: k.account_number, swift: k.swift, bank_code: k.bank_code, account_currency: null, provenance: k.provenance });
  }
  if (p && (p.account_number || p.bank)) {
    bank_candidates.push({ source: 'payout_sheet', beneficiary: p.beneficiary_ar || p.name, bank: p.bank, branch: p.branch, country: '', iban: '', account_number: p.account_number, swift: '', bank_code: '', account_currency: p.account_currency || null, provenance: p.provenance });
  }
  if (bank) {
    const k = bank.row;
    const isIban = /^[A-Z]{2}\d{2}[A-Z0-9]{8,}$/.test(k.iban_or_account);
    bank_candidates.push({ source: 'bank_sheet', beneficiary: k.beneficiary || k.name, bank: k.bank, branch: k.branch, country: k.country, iban: isIban ? k.iban_or_account : '', account_number: isIban ? '' : k.iban_or_account, swift: k.swift, bank_code: '', account_currency: null, provenance: k.provenance });
  }

  return {
    key: `${row.crew_id}:${cur}`, crew_id: row.crew_id, name: sheet?.full_name || row.name, rank: row.rank, nationality: row.nationality,
    currency: cur, payment_currency: cur, payment_currency_exception: false, section: row.section, input, result, reported, reported_balance,
    differences: compareWithReported(result, reported, reported_balance), source_conflicts,
    provenance: [row.provenance, ...(sheet ? [{ file: row.provenance.file, sheet: sheet.sheet, row: 1 }] : [])],
    payout_match: payout ? { ...payout.match, row: payout.row.provenance.row, name: payout.row.name } : null,
    bank_match: bank ? { ...bank.match, row: bank.row.provenance.row, name: bank.row.name } : null,
    bank_candidates, date_checks,
  };
}

export { sourceKey };
