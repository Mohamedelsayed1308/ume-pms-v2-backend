import Decimal from 'decimal.js';

/**
 * محرّك حساب مرتّبات الأطقم — منطقٌ خالص، بلا قاعدة ولا شبكة ولا نموذج ذكاء.
 *
 * ── القواعد (بقرار المالك، ثابتة) ──
 * • كلّ بندٍ شهريّ (الأساسيّ، الإضافيّ الثابت، بدل الإجازة) = الشهريّ ÷ ٣٠ × أيّام الاستحقاق.
 * • الشهر الكامل = ٣٠ يوماً أيّاً كان طوله. والجزئيّ = الأيّام الفعليّة داخل الشهر، بسقف ٣٠.
 * • الحساب عشريٌّ دقيق (`decimal.js`)، ويُقرَّب **كلّ بندٍ** إلى منزلتين (نصفٌ لأعلى) قبل الجمع.
 * • يوم النزول الإضافيّ = (الأساسيّ + الإضافيّ الثابت) ÷ ٣٠ — **بلا بدل الإجازة** — سطرٌ مستقلّ،
 *   ولا يُمنح إن بلغت الأيّام ٣٠ (أيّام الأساسيّ + اليوم ≤ ٣٠).
 * • يوم الصعود لا يُحسب تلقائيّاً: يأتي تسويةً مستقلّة موثّقة تنتظر المراجعة.
 * • مبالغ اللاشينج والمكافآت وفروق المرتّب والأمتعة تُستورد كما هي، كلٌّ ببنده وسببه ومصدره.
 * • عملة الصرف = عملة العقد. وما جاء بعملةٍ أخرى يُحوَّل بسعر الشهر اليدويّ مرّةً واحدة
 *   من مبلغه الأصليّ، ويُحفظ الأصل والمحوَّل والسعر. غياب السعر يوقف البند — لا ١ ولا تخمين.
 * • لا جمع بين عملتين أبداً.
 */

Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

export const MONTH_DAYS = 30;

export type ItemKind =
  | 'basic' | 'fixed_ot' | 'leave'
  | 'sign_off_day'          // يوم النزول الإضافيّ — محسوبٌ بالقاعدة
  | 'sign_on_settlement'    // يوم الصعود — تسويةٌ للمراجعة لا تلقائيّة
  | 'lashing' | 'captain_bonus' | 'bonus'
  | 'salary_difference' | 'luggage' | 'other_earning'
  | 'cash_advance' | 'other_deduction';

export const DEDUCTION_KINDS: ReadonlySet<ItemKind> = new Set(['cash_advance', 'other_deduction']);
export const RATE_KINDS = ['basic', 'fixed_ot', 'leave'] as const;

/** بندٌ مستورَد أو يدويّ — مبلغه بعملته الأصليّة، كما جاء في مصدره. */
export interface ExtraItemInput {
  key: string;                       // معرّفٌ ثابت للبند (للمراجعة والتدقيق)
  kind: ItemKind;
  amount: string;                    // بالعملة الأصليّة
  currency: string;                  // العملة الأصليّة
  reason?: string;
  source?: string;                   // email · cfm · attachment · manual
  review: 'pending' | 'accepted' | 'rejected';
}

export interface EntryInput {
  month: string;                     // YYYY-MM
  currency: string;                  // عملة العقد = عملة الصرف
  payStart: string | null;           // YYYY-MM-DD
  payEnd: string | null;
  signsOffThisMonth: boolean;        // نهاية الخدمة يوم نزول (قسم «الحساب النهائيّ»)
  rates: { basic: string; fixed_ot: string; leave: string } | null; // null = استحقاقٌ تكميليّ بلا مرتّب
  extras: ExtraItemInput[];
}

/** سعر الشهر: كم وحدةً من العملة مقابل ١ دولار — كجدول `exchange_rates` القائم. */
export interface FxMonth {
  month: string;
  perUsd: Record<string, string>;
}

export type IssueCode =
  | 'dates_missing' | 'dates_outside_month' | 'dates_inverted'
  | 'rates_missing' | 'fx_missing' | 'item_pending_review' | 'days_capped';

export interface Issue {
  code: IssueCode;
  blocking: boolean;
  message: string;
  itemKey?: string;
}

export interface CalcItem {
  key: string;
  kind: ItemKind;
  direction: 'earning' | 'deduction';
  amount: string | null;             // بعملة الصرف، منزلتان — null إن تعذّر (سعرٌ غائب)
  currency: string;                  // عملة الصرف
  // التحويل — يظهر كما هو ولا يُعاد تحويل المحوَّل
  original_amount: string;
  original_currency: string;
  fx_rate: string | null;            // ١ عملة أصليّة = X عملة صرف
  // الحساب
  monthly_rate?: string;
  days?: number;
  formula?: string;
  reason?: string;
  source: string;
  review: 'auto' | 'pending' | 'accepted' | 'rejected';
  counted: boolean;                  // داخل الصافي أم لا (المعلّق والمرفوض خارجه)
}

export interface EntryResult {
  currency: string;
  days: number | null;
  day_rule: 'full_month' | 'partial' | null;
  service: { start: string | null; end: string | null; month_start: string; month_end: string };
  items: CalcItem[];
  earnings: string;
  deductions: string;
  balance: string;
  complete: boolean;                 // لا بند معلّق ولا مانع
  issues: Issue[];
}

const D = (v: Decimal.Value) => new Decimal(v);
const r2 = (d: Decimal) => d.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
const fix2 = (d: Decimal) => r2(d).toFixed(2);

export function isMoney(s: unknown): s is string {
  return typeof s === 'string' && /^-?\d+(\.\d+)?$/.test(s.trim());
}

/** يقبل رقماً أو نصّاً ويرفض ما ليس رقماً عشريّاً صريحاً (لا NaN ولا فواصل آلاف). */
export function money(v: unknown): string | null {
  if (typeof v === 'number') return Number.isFinite(v) ? D(v).toString() : null;
  if (typeof v === 'string') {
    const s = v.trim().replace(/,/g, '');
    return isMoney(s) ? D(s).toString() : null;
  }
  return null;
}

export function monthBounds(month: string): { start: string; end: string; length: number } {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  if (!m) throw new Error(`شهرٌ غير صالح: ${month}`);
  const y = Number(m[1]), mo = Number(m[2]);
  const length = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  return { start: `${month}-01`, end: `${month}-${String(length).padStart(2, '0')}`, length };
}

const dayNum = (iso: string) => Math.round(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 86_400_000);
const isIso = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);

/**
 * أيّام الاستحقاق: الشهر الكامل ٣٠، والجزئيّ عدد الأيّام شاملاً الطرفين، بسقف ٣٠.
 * (٦–٣١ أغسطس = ٢٦ · ١–٢٠ = ٢٠ · ١–٣١ = ٣٠ · ١–٢٨ فبراير = ٣٠)
 */
export function entitlementDays(month: string, start: string, end: string): { days: number; rule: 'full_month' | 'partial'; capped: boolean } {
  const b = monthBounds(month);
  if (start === b.start && end === b.end) return { days: MONTH_DAYS, rule: 'full_month', capped: false };
  const raw = dayNum(end) - dayNum(start) + 1;
  return { days: Math.min(raw, MONTH_DAYS), rule: 'partial', capped: raw > MONTH_DAYS };
}

/** بندٌ شهريّ: الشهريّ ÷ ٣٠ × الأيّام، مقرّباً إلى منزلتين. */
export function proRata(monthly: string, days: number): string {
  return fix2(D(monthly).div(MONTH_DAYS).mul(days));
}

/** يوم النزول: (الأساسيّ + الإضافيّ الثابت) ÷ ٣٠ — بلا بدل الإجازة. */
export function signOffDay(basicMonthly: string, fixedOtMonthly: string): string {
  return fix2(D(basicMonthly).plus(fixedOtMonthly).div(MONTH_DAYS));
}

/**
 * سعر التحويل من عملةٍ إلى أخرى بجدول «لكلّ دولار».
 * يعيد null إن غاب أيٌّ من الطرفين — لا افتراض ١ ولا قيمة احتياطيّة.
 */
export function crossRate(fx: FxMonth | null, from: string, to: string): Decimal | null {
  if (from === to) return D(1);
  if (!fx) return null;
  const per = (c: string) => {
    if (c === 'USD') return D(1);
    const v = fx.perUsd?.[c];
    return isMoney(v) && D(v).gt(0) ? D(v) : null;
  };
  const f = per(from), t = per(to);
  if (!f || !t) return null;
  return t.div(f);
}

/** «١ EUR = 1.170000 USD» — اتجاه السعر صريحٌ دائماً. */
export function rateLabel(from: string, to: string, rate: Decimal | string): string {
  return `1 ${from} = ${D(rate).toFixed(6)} ${to}`;
}

export function computeEntry(input: EntryInput, fx: FxMonth | null): EntryResult {
  const cur = input.currency.toUpperCase();
  const b = monthBounds(input.month);
  const issues: Issue[] = [];
  const items: CalcItem[] = [];
  let days: number | null = null;
  let rule: EntryResult['day_rule'] = null;

  // ── الخدمة والأيّام ──
  if (input.rates) {
    const { payStart: s, payEnd: e } = input;
    if (!isIso(s) || !isIso(e)) {
      issues.push({ code: 'dates_missing', blocking: true, message: 'تاريخا بداية الخدمة ونهايتها غير مكتملين' });
    } else if (s > e) {
      issues.push({ code: 'dates_inverted', blocking: true, message: `بداية الخدمة ${s} بعد نهايتها ${e}` });
    } else if (s < b.start || e > b.end) {
      issues.push({ code: 'dates_outside_month', blocking: true, message: `فترة الخدمة ${s} → ${e} تخرج عن شهر ${input.month}` });
    } else {
      const d = entitlementDays(input.month, s, e);
      days = d.days; rule = d.rule;
      if (d.capped) issues.push({ code: 'days_capped', blocking: false, message: 'الأيّام تجاوزت ٣٠ فقُصرت على ٣٠' });
    }
    const r = input.rates;
    if (![r.basic, r.fixed_ot, r.leave].every(isMoney)) {
      issues.push({ code: 'rates_missing', blocking: true, message: 'المرتّبات الشهريّة غير مكتملة' });
    } else if (days != null) {
      const labels: Record<string, string> = { basic: 'الأساسيّ', fixed_ot: 'الإضافيّ الثابت', leave: 'بدل الإجازة' };
      for (const k of RATE_KINDS) {
        items.push({
          key: k, kind: k, direction: 'earning',
          amount: proRata(r[k], days), currency: cur,
          original_amount: proRata(r[k], days), original_currency: cur, fx_rate: null,
          monthly_rate: D(r[k]).toFixed(2), days,
          formula: `${labels[k]} ${D(r[k]).toFixed(2)} ÷ 30 × ${days}`,
          source: 'calc', review: 'auto', counted: true,
        });
      }
      // يوم النزول: فقط لمن ينزل هذا الشهر ولم تبلغ أيّامه ٣٠
      if (input.signsOffThisMonth && days < MONTH_DAYS) {
        const amt = signOffDay(r.basic, r.fixed_ot);
        items.push({
          key: 'sign_off_day', kind: 'sign_off_day', direction: 'earning',
          amount: amt, currency: cur, original_amount: amt, original_currency: cur, fx_rate: null,
          days: 1,
          formula: `(الأساسيّ ${D(r.basic).toFixed(2)} + الإضافيّ الثابت ${D(r.fixed_ot).toFixed(2)}) ÷ 30 — بلا بدل الإجازة`,
          source: 'calc', review: 'auto', counted: true,
        });
      }
    }
  }

  // ── البنود المستوردة واليدويّة ──
  for (const x of input.extras) {
    // يوم النزول محسوبٌ بالقاعدة — والمستورَد منه مرجعٌ للمقارنة لا بندٌ ثانٍ
    if (x.kind === 'sign_off_day') continue;
    const oc = x.currency.toUpperCase();
    const direction = DEDUCTION_KINDS.has(x.kind) ? 'deduction' : 'earning';
    const orig = money(x.amount);
    const rate = orig == null ? null : crossRate(fx, oc, cur);
    let amount: string | null = null;
    if (orig != null && rate) amount = oc === cur ? fix2(D(orig)) : fix2(D(orig).mul(rate));
    if (orig != null && !rate) {
      issues.push({
        code: 'fx_missing', blocking: true, itemKey: x.key,
        message: `لا سعر صرف ${oc}/${cur} لشهر ${input.month} — البند موقوفٌ حتّى إدخاله`,
      });
    }
    if (x.review === 'pending') {
      issues.push({ code: 'item_pending_review', blocking: true, itemKey: x.key, message: `بندٌ ينتظر المراجعة: ${x.reason || x.kind}` });
    }
    items.push({
      key: x.key, kind: x.kind, direction,
      amount, currency: cur,
      original_amount: orig == null ? String(x.amount) : fix2(D(orig)), original_currency: oc,
      fx_rate: oc === cur || !rate ? null : rate.toFixed(10),
      reason: x.reason, source: x.source || 'manual', review: x.review,
      counted: x.review === 'accepted' && amount != null,
    });
  }

  let earn = D(0), ded = D(0);
  for (const it of items) {
    if (!it.counted || it.amount == null) continue;
    if (it.direction === 'earning') earn = earn.plus(it.amount);
    else ded = ded.plus(it.amount);
  }

  return {
    currency: cur, days, day_rule: rule,
    service: { start: input.payStart, end: input.payEnd, month_start: b.start, month_end: b.end },
    items,
    earnings: fix2(earn), deductions: fix2(ded), balance: fix2(earn.minus(ded)),
    complete: !issues.some((i) => i.blocking),
    issues,
  };
}

/** مقارنة المحسوب بالمُصدَّر من CFM — بنداً بنداً، وبعملة الصرف وحدها. */
export interface ReportedItem { kind: ItemKind; amount: string; description?: string }

export interface Difference {
  kind: ItemKind | 'balance';
  calculated: string | null;
  reported: string | null;
  diff: string | null;               // المحسوب − المُصدَّر
}

/**
 * المكافآت تُقارَن مجموعةً واحدة: ما تسمّيه الرسالة «Bonus» يسمّيه CFM «lashing Bonus»
 * لبعض الطاقم — والمبلغ واحد. فالمقارنة بندٌ بندٌ هنا تخترع فرقين وهميّين متعاكسين.
 * ويبقى لكلّ بندٍ نوعه في الحساب والعرض.
 */
export const COMPARE_GROUP: Partial<Record<ItemKind, ItemKind>> = { lashing: 'bonus', captain_bonus: 'bonus' };
const groupOf = (k: ItemKind): ItemKind => COMPARE_GROUP[k] || k;

export function compareWithReported(result: EntryResult, reported: ReportedItem[], reportedBalance: string | null): Difference[] {
  const sum = (arr: string[]) => arr.reduce((a, b) => a.plus(b), D(0));
  const calcBy = new Map<string, string[]>();
  for (const it of result.items) {
    if (it.amount == null || it.review === 'rejected') continue;
    const k = groupOf(it.kind);
    calcBy.set(k, [...(calcBy.get(k) || []), it.amount]);
  }
  const repBy = new Map<string, string[]>();
  for (const r of reported) {
    const m = money(r.amount);
    const k = groupOf(r.kind);
    if (m != null) repBy.set(k, [...(repBy.get(k) || []), m]);
  }
  const kinds = new Set<string>([...calcBy.keys(), ...repBy.keys()]);
  const out: Difference[] = [];
  for (const k of kinds) {
    const c = calcBy.has(k) ? sum(calcBy.get(k)!) : null;
    const r = repBy.has(k) ? sum(repBy.get(k)!) : null;
    const diff = r2(D(c ?? 0).minus(r ?? 0));
    if (!diff.isZero()) out.push({ kind: k as ItemKind, calculated: c && fix2(c), reported: r && fix2(r), diff: diff.toFixed(2) });
  }
  if (reportedBalance != null && money(reportedBalance) != null) {
    // الصافي المحسوب يشمل المعلّق (للمقارنة وحدها) — كي لا يبدو كلّ بندٍ معلّقٍ فرقاً في الصافي
    let e = D(0), d = D(0);
    for (const it of result.items) {
      if (it.amount == null || it.review === 'rejected') continue;
      if (it.direction === 'earning') e = e.plus(it.amount); else d = d.plus(it.amount);
    }
    const bal = r2(e.minus(d));
    const diff = r2(bal.minus(money(reportedBalance)!));
    if (!diff.isZero()) out.push({ kind: 'balance', calculated: bal.toFixed(2), reported: fix2(D(money(reportedBalance)!)), diff: diff.toFixed(2) });
  }
  const order = ['basic', 'fixed_ot', 'leave', 'sign_off_day', 'sign_on_settlement', 'lashing', 'captain_bonus', 'bonus', 'salary_difference', 'luggage', 'other_earning', 'cash_advance', 'other_deduction', 'balance'];
  return out.sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
}

/** إجماليّاتٌ لكلّ عملةٍ على حدة — لا يُجمع اثنان بعملتين. */
export function totalsByCurrency(results: EntryResult[]): Record<string, { earnings: string; deductions: string; balance: string; count: number; complete: number }> {
  const acc: Record<string, { e: Decimal; d: Decimal; count: number; complete: number }> = {};
  for (const r of results) {
    const t = (acc[r.currency] ||= { e: D(0), d: D(0), count: 0, complete: 0 });
    t.e = t.e.plus(r.earnings); t.d = t.d.plus(r.deductions); t.count++;
    if (r.complete) t.complete++;
  }
  const out: Record<string, { earnings: string; deductions: string; balance: string; count: number; complete: number }> = {};
  for (const [c, t] of Object.entries(acc)) {
    out[c] = { earnings: fix2(t.e), deductions: fix2(t.d), balance: fix2(t.e.minus(t.d)), count: t.count, complete: t.complete };
  }
  return out;
}
