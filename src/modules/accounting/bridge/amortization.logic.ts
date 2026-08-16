import { BadRequestException } from '@nestjs/common';
import { round2 } from '../accounting-posting';
import { deterministicUuid, lastDayOfMonth, monthsBetween } from './depreciation.logic';

/**
 * ── إطفاء المصروفات المدفوعة مقدماً — منطق خالص ──
 *
 * أدواتُ الزمن والمعرّف الحتمي مشتركة مع الإهلاك ولا تُكرَّر: `monthsBetween`
 * و`lastDayOfMonth` و`deterministicUuid` تُستورَد من هناك. المُطفَأ يختلف عن
 * المُهلَك في موضوعه لا في تقويمه.
 *
 * والفرق الجوهري بينهما **الباقي**: الأصل يُهلَك إلى قيمة متبقّية مقبولة، أما
 * المصروف المقدَّم فيجب أن يبلغ **الصفر تماماً**. وقسمةُ مبلغٍ على عدد أشهر
 * تترك كسوراً — 634,285.67 على 23 شهراً تترك سنتات تتراكم — فيبقى في الحساب
 * رصيدٌ شبح لا يُطفأ أبداً. ولذلك يحمل الشهر الأخير الفرق كلَّه.
 */

export interface AmortizationMonth {
  month: string;            // YYYY-MM
  accounting_date: string;  // آخر يوم في الشهر
  amount: number;
}

/**
 * توزيع المبلغ على أشهره — والشهر الأخير يحمل الباقي.
 *
 * المجموع المُوزَّع يساوي المبلغ الأصلي بالسنت دائماً، مهما كان عدد الأشهر.
 */
export function spreadAmount(total: number, months: string[], fixedMonthly?: number | null): AmortizationMonth[] {
  const amount = round2(total);
  if (!(amount > 0)) throw new BadRequestException('المبلغ المُطفأ يجب أن يكون موجباً');
  if (!months.length) throw new BadRequestException('لا أشهر للإطفاء');

  /*
   * القسط الثابت حين يُملى من خارج.
   *
   * أصلٌ بدأ إطفاؤه في دفترٍ سابق له قسطٌ قائم لا يُشتقّ من رصيده المتبقّي:
   * الدُّراي دوك يُطفأ 30,645 شهرياً منذ فبراير 2025، وقسمةُ ما تبقّى على مدّته
   * تعطي 29,537.80 — رقمٌ يخالف الدفتر الأصلي بألفٍ ومئة كل شهر ويكسر
   * المقارنة بين النظامين.
   *
   * والأخير يحمل الباقي في الحالتين، فالمجموع يطابق الأصل بالسنت.
   */
  const per = fixedMonthly && fixedMonthly > 0 ? round2(fixedMonthly) : round2(amount / months.length);
  return months.map((month, i) => ({
    month,
    accounting_date: lastDayOfMonth(month),
    amount: i === months.length - 1 ? round2(amount - per * (months.length - 1)) : per,
  }));
}

export interface PrepaidSchedule {
  id: string;
  description: string | null;
  source_reference: string | null;
  total_amount: number;
  start_month: string;
  end_month: string;
  expense_account_id: string;
  prepaid_account_id: string;
  vessel_id: string | null;
  customer_id: string | null;
  /** قسطٌ ثابت يُملى من خارج — يغلب القسمة على عدد الأشهر. */
  monthly_amount?: number | null;
}

export interface AmortizationLine {
  schedule_id: string;
  expense_account_id: string;
  prepaid_account_id: string;
  vessel_id: string | null;
  customer_id: string | null;
  amount: number;
  description: string;
}

/**
 * حصّة شهرٍ واحد من جدولٍ واحد — أو `null` إن كان الشهر خارج مدّته.
 *
 * تُحسب من التوزيع الكامل لا بالقسمة المباشرة، فيصيب الشهرَ الأخيرَ باقيه.
 */
export function monthShare(s: PrepaidSchedule, month: string): AmortizationLine | null {
  if (month < s.start_month || month > s.end_month) return null;
  const spread = spreadAmount(s.total_amount, monthsBetween(s.start_month, s.end_month), s.monthly_amount);
  const hit = spread.find((x) => x.month === month);
  if (!hit) return null;
  return {
    schedule_id: s.id,
    expense_account_id: s.expense_account_id,
    prepaid_account_id: s.prepaid_account_id,
    vessel_id: s.vessel_id,
    customer_id: s.customer_id,
    amount: hit.amount,
    description: `إطفاء ${month} — ${s.description ?? s.source_reference ?? ''}`.trim(),
  };
}

export interface MonthlyAmortization {
  month: string;
  accounting_date: string;
  source_id: string;
  source_reference: string;
  /** سطرٌ مدين لكل حساب مصروف — الجداول ذات الحساب الواحد تُجمَع. */
  debits: { expense_account_id: string; amount: number; description: string;
    vessel_id: string | null; customer_id: string | null }[];
  /**
   * سطرٌ دائن لكل حساب مقدَّم.
   *
   * كان القيد يرفض شهراً فيه حسابا مقدَّم مختلفان — قيدٌ ضيّق بلا سبب: القيد
   * يحتمل أي عدد من السطور، والرفض كان يمنع حالةً مشروعة تماماً — تأميناتٌ على
   * حسابٍ وعقودُ إعادة تحميل على آخر، يلتقيان في الشهر نفسه.
   */
  credits: { prepaid_account_id: string; amount: number }[];
  total: number;
}

/**
 * قيد شهرٍ واحد يجمع كل الجداول المستحقّة فيه.
 *
 * قيدٌ لكل جدول يعني واحداً وثلاثين قيداً في الشهر و**سبعمئة** حتى نهاية المدّة
 * — دفترٌ لا يُقرأ. والتجميع بحساب المصروف يُبقي التفصيل في السطور ويُنقص
 * القيود إلى واحد.
 *
 * والمعرّف الحتمي من الكيان والشهر: تكرار التوليد لا يُنتج قيداً ثانياً، ويمنعه
 * فهرس التكرار في القاعدة لا فحصٌ تطبيقي يُلتَفّ عليه.
 */
export function planMonth(args: {
  entityId: string;
  month: string;
  schedules: PrepaidSchedule[];
  namespace: string;
}): MonthlyAmortization | null {
  const lines = args.schedules
    .map((s) => monthShare(s, args.month))
    .filter((x): x is AmortizationLine => x !== null && x.amount !== 0);
  if (!lines.length) return null;

  const byAccount = new Map<string, AmortizationLine[]>();
  for (const l of lines) {
    byAccount.set(l.expense_account_id, [...(byAccount.get(l.expense_account_id) ?? []), l]);
  }

  const byPrepaid = new Map<string, number>();
  for (const l of lines) {
    byPrepaid.set(l.prepaid_account_id, round2((byPrepaid.get(l.prepaid_account_id) ?? 0) + l.amount));
  }

  const debits = [...byAccount.entries()].map(([acc, ls]) => ({
    expense_account_id: acc,
    amount: round2(ls.reduce((s, l) => s + l.amount, 0)),
    // البيان يحمل عدد العقود لا أسماءها: سطرٌ يحمل ثلاثين اسماً لا يُقرأ
    description: ls.length === 1 ? ls[0].description : `إطفاء ${args.month} — ${ls.length} عقود`,
    vessel_id: ls[0].vessel_id,
    customer_id: null as string | null,
  }));

  const total = round2(debits.reduce((s, d) => s + d.amount, 0));
  return {
    month: args.month,
    accounting_date: lastDayOfMonth(args.month),
    source_id: deterministicUuid(args.namespace, `prepaid|${args.entityId}|${args.month}`),
    source_reference: `AMORT-${args.month}`,
    debits,
    credits: [...byPrepaid.entries()].map(([prepaid_account_id, amount]) => ({ prepaid_account_id, amount })),
    total,
  };
}

/**
 * الأشهر المستحقّة بلا قيد — من بداية الجداول إلى آخر شهر مكتمل.
 *
 * الشهر الجاري لم ينتهِ فلا يُطفأ، وما مضى بلا قيد يُلحَق مهما تأخّر.
 */
export function amortizationMonthsDue(args: {
  schedules: PrepaidSchedule[];
  today: string;
  alreadyPosted: string[];
}): string[] {
  if (!args.schedules.length) return [];
  const [y, m] = args.today.slice(0, 7).split('-').map(Number);
  const lastCompleted = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;

  const start = args.schedules.map((s) => s.start_month).sort()[0];
  const end = args.schedules.map((s) => s.end_month).sort().reverse()[0];
  const upto = end < lastCompleted ? end : lastCompleted;
  if (upto < start) return [];

  const done = new Set(args.alreadyPosted);
  return monthsBetween(start, upto).filter((mo) => !done.has(mo));
}
