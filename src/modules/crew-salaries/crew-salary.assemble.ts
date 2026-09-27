import { computeEntry, compareWithReported, monthBounds, type Difference, type EntryInput, type EntryResult, type ExtraItemInput, type FxMonth, type ReportedItem } from './crew-salary.calc';
import { matchName, sourceKey, type Candidate, type MatchResult } from './crew-salary.match';
import type { CfmExport, CfmSeafarer, CfmSummaryRow, Provenance } from './parsers/cfm.parser';
import type { EmailNote, EmailRow, ParsedEmailBody } from './parsers/email-body.parser';
import type { BankBlock, CrewListRow, PayoutRow } from './parsers/attachments.parser';

/**
 * تجميع دورة شهرٍ لمركب من مصادرها — منطقٌ خالص.
 *
 * • **CFM** يعطي: من في الكشف، وعملة عقده، وتاريخي خدمته، ومرتّباته الشهريّة، وما صدّره
 *   من مبالغ (للمقارنة وحدها — لا يدخل منها بندٌ في الحساب إلّا السلفة عند غياب مصدرها).
 * • **الرسالة** تعطي البنود الإضافيّة (لاشينج، مكافأة، أمتعة، فرق مرتّب، يوما النزول والصعود).
 * • **كشف الصرف** يعطي السلف باليورو وبيانات بنوك المصريّين وتاريخي الرفت والتعيين.
 * • **كشف البنوك** يعطي حسابات الأجانب.
 *
 * وكلّ بندٍ مستورَد يبدأ «معلّقاً» حتّى يراجعه إنسان — إلّا ما قرّرته المراجعة سلفاً.
 */

export interface Sources {
  month: string;
  vessel: string;
  cfm: CfmExport[];
  email?: ParsedEmailBody | null;
  email_file?: string;
  payout?: PayoutRow[];
  bank_blocks?: BankBlock[];
  crew_list?: CrewListRow[];
  links?: Map<string, string>;                         // مفتاح الاسم ⇒ رقم البحّار (مؤكَّد)
  reviews?: Record<string, 'accepted' | 'rejected'>;   // مفتاح البند ⇒ قرار المراجعة
  manual?: { crew_id: string; currency: string; item: ExtraItemInput }[];
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
  national_id: string;
  provenance: Provenance;
}

export interface DateCheck { field: 'pay_start' | 'pay_end'; cfm: string | null; other: string; source: string; provenance: Provenance }

export interface AssembledEntry {
  key: string;                                         // crew_id:CUR
  crew_id: string;
  name: string;
  rank: string;
  nationality: string;
  currency: string;
  section: 'monthly' | 'final' | 'supplementary';
  input: EntryInput;
  result: EntryResult;
  reported: ReportedItem[];
  reported_balance: string | null;
  differences: Difference[];
  provenance: Provenance[];
  payout_match: (MatchResult & { row: number; name: string }) | null;
  bank_match: (MatchResult & { row: number; name: string }) | null;
  bank_candidates: BankCandidate[];
  date_checks: DateCheck[];
}

export interface Unmatched {
  payout: { row: PayoutRow; match: MatchResult }[];
  bank_blocks: { row: BankBlock; match: MatchResult }[];
  email_rows: EmailRow[];
  notes: EmailNote[];
}

export interface Assembled {
  month: string;
  vessel: string;
  entries: AssembledEntry[];
  unmatched: Unmatched;
  warnings: string[];
}

export function assemble(src: Sources, fx: FxMonth | null): Assembled {
  const warnings: string[] = [];
  const reviews = src.reviews || {};
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
    const m2 = match.status === 'none' || match.status === 'suggested' ? matchName(row.name, candidates, src.links) : match;
    const best = linked(match) ? match : m2;
    const id = linked(best);
    if (id && !bankBy.has(id)) bankBy.set(id, { row, match: best });
    else unmatchedBank.push({ row, match: best });
  }

  const emailBy = new Map<string, EmailRow[]>();
  for (const t of src.email?.tables || []) {
    for (const r of t.rows) if (r.crew_id) emailBy.set(r.crew_id, [...(emailBy.get(r.crew_id) || []), r]);
  }
  const emailCurrency = new Map<number, string | null>((src.email?.tables || []).map((t) => [t.index, t.currency]));

  const entries: AssembledEntry[] = [];
  const seen = new Set<string>();
  const b = monthBounds(src.month);

  for (const x of src.cfm) {
    if (x.month && x.month !== src.month) warnings.push(`تصدير CFM بعملة ${x.currency} لشهر ${x.month} لا ${src.month}`);
    const sheetBy = new Map<string, CfmSeafarer>(x.seafarers.map((s) => [s.crew_id, s]));
    for (const row of x.rows) {
      const sheet = sheetBy.get(row.crew_id) || null;
      if (!sheet) warnings.push(`البحّار ${row.crew_id} بلا ورقة تفصيليّة في تصدير ${x.currency} — مرتّبه الشهريّ غير معروف`);
      const e = buildEntry(src, x, row, sheet, emailBy.get(row.crew_id) || [], emailCurrency, payoutBy.get(row.crew_id), bankBy.get(row.crew_id), decide, fx, b);
      seen.add(row.crew_id);
      entries.push(e);
    }
  }

  // ── بحّارةٌ في الرسالة لا في CFM: استحقاقٌ تكميليّ بلا مرتّب ──
  const unmatchedEmail: EmailRow[] = [];
  for (const [id, rows] of emailBy) {
    if (seen.has(id)) continue;
    const cur = rows.map((r) => emailCurrency.get(r.table)).find(Boolean) || null;
    if (!cur) { unmatchedEmail.push(...rows); continue; }
    const extras = rows.flatMap((r) => emailExtras(r, cur, src.email_file, decide));
    const input: EntryInput = { month: src.month, currency: cur, payStart: null, payEnd: null, signsOffThisMonth: false, rates: null, extras };
    const result = computeEntry(input, fx);
    entries.push({
      key: `${id}:${cur}`, crew_id: id, name: rows[0].name, rank: rows[0].rank, nationality: rows[0].nationality,
      currency: cur, section: 'supplementary', input, result, reported: [], reported_balance: null,
      differences: [], provenance: rows.map((r) => ({ file: src.email_file, sheet: `email-table-${r.table}`, row: r.row })),
      payout_match: null, bank_match: null, bank_candidates: [], date_checks: [],
    });
  }

  for (const m of src.manual || []) {
    const e = entries.find((x) => x.crew_id === m.crew_id && x.currency === m.currency);
    if (!e) { warnings.push(`بندٌ يدويّ لبحّارٍ غير موجود في الدورة: ${m.crew_id}/${m.currency}`); continue; }
    e.input.extras.push({ ...m.item, review: reviews[m.item.key] || m.item.review });
    e.result = computeEntry(e.input, fx);
    e.differences = compareWithReported(e.result, e.reported, e.reported_balance);
  }

  return {
    month: src.month, vessel: src.vessel, entries,
    unmatched: { payout: unmatchedPayout, bank_blocks: unmatchedBank, email_rows: unmatchedEmail, notes: src.email?.notes || [] },
    warnings,
  };
}

function emailExtras(r: EmailRow, cur: string, file: string | undefined, decide: (k: string) => ExtraItemInput['review']): ExtraItemInput[] {
  return r.items.map((it) => {
    const key = `email:t${r.table}:r${r.row}:${it.kind}`;
    return {
      key, kind: it.kind, amount: it.amount, currency: cur,
      reason: [it.column, r.statement].filter(Boolean).join(' — '),
      source: 'email', review: decide(key),
    };
  });
}

function buildEntry(
  src: Sources, x: CfmExport, row: CfmSummaryRow, sheet: CfmSeafarer | null, emailRows: EmailRow[],
  emailCurrency: Map<number, string | null>, payout: { row: PayoutRow; match: MatchResult } | undefined,
  bank: { row: BankBlock; match: MatchResult } | undefined, decide: (k: string) => ExtraItemInput['review'],
  fx: FxMonth | null, b: { start: string; end: string },
): AssembledEntry {
  const cur = x.currency;
  const extras: ExtraItemInput[] = [];
  // بنود الرسالة — بعملة جدولها، وإلّا عملة العقد (يُذكر ذلك في السبب)
  for (const r of emailRows) {
    const tc = emailCurrency.get(r.table) || null;
    for (const it of emailExtras(r, tc || cur, src.email_file, decide)) {
      extras.push(tc ? it : { ...it, reason: `${it.reason} (عملة الجدول غير مذكورة — عملة العقد ${cur})` });
    }
  }
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
    extras.push({ key, kind, amount: v, currency: p!.account_currency || cur, reason: `${label} — كشف الصرف (العملة من عملة الحساب — تحقّق)`, source: 'attachment', review: decide(key) });
  }

  const rates = sheet && sheet.rates.basic && sheet.rates.fixed_ot && sheet.rates.leave
    ? { basic: sheet.rates.basic, fixed_ot: sheet.rates.fixed_ot, leave: sheet.rates.leave }
    : { basic: '', fixed_ot: '', leave: '' };
  const signsOff = row.section === 'final' && !!row.pay_end && row.pay_end < b.end;
  const input: EntryInput = {
    month: src.month, currency: cur, payStart: row.pay_start, payEnd: row.pay_end,
    signsOffThisMonth: signsOff, rates, extras,
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

  const bank_candidates: BankCandidate[] = [];
  if (sheet?.bank) {
    const k = sheet.bank;
    bank_candidates.push({ source: 'cfm_sheet', beneficiary: k.beneficiary, bank: k.bank, branch: '', country: '', iban: k.iban, account_number: k.account_number, swift: k.swift, bank_code: k.bank_code, account_currency: null, national_id: '', provenance: k.provenance });
  }
  if (p && (p.account_number || p.bank)) {
    bank_candidates.push({ source: 'payout_sheet', beneficiary: p.beneficiary_ar || p.name, bank: p.bank, branch: p.branch, country: '', iban: '', account_number: p.account_number, swift: '', bank_code: '', account_currency: p.account_currency || null, national_id: p.national_id, provenance: p.provenance });
  }
  if (bank) {
    const k = bank.row;
    const isIban = /^[A-Z]{2}\d{2}[A-Z0-9]{8,}$/.test(k.iban_or_account);
    bank_candidates.push({ source: 'bank_sheet', beneficiary: k.beneficiary || k.name, bank: k.bank, branch: k.branch, country: k.country, iban: isIban ? k.iban_or_account : '', account_number: isIban ? '' : k.iban_or_account, swift: k.swift, bank_code: '', account_currency: null, national_id: '', provenance: k.provenance });
  }

  return {
    key: `${row.crew_id}:${cur}`, crew_id: row.crew_id, name: sheet?.full_name || row.name, rank: row.rank, nationality: row.nationality,
    currency: cur, section: row.section, input, result, reported, reported_balance,
    differences: compareWithReported(result, reported, reported_balance),
    provenance: [row.provenance, ...(sheet ? [{ file: row.provenance.file, sheet: sheet.sheet, row: 1 }] : [])],
    payout_match: payout ? { ...payout.match, row: payout.row.provenance.row, name: payout.row.name } : null,
    bank_match: bank ? { ...bank.match, row: bank.row.provenance.row, name: bank.row.name } : null,
    bank_candidates, date_checks,
  };
}

export { sourceKey };
