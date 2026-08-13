import { monthsBetween } from './depreciation.logic';

/**
 * ── اللحاق بالأشهر الفائتة — منطق خالص ──
 *
 * مهمّة تُطلق مرّة في نهاية الشهر تفشل بصمت إن كان الخادم يُعاد نشره تلك الليلة،
 * ولا يكتشف أحد الشهر الغائب إلا عند إقفال السنة.
 *
 * فالسؤال المطروح هنا ليس «هل حان موعد الشهر؟» بل **«أي شهر مكتمل بلا قيد؟»**.
 * والسؤال الثاني لا يفوته شيء مهما انقطعت الخدمة، ولا يضرّه أن يُسأل مئة مرة.
 */

/** الشهر المكتمل الأخير — الشهر الجاري لم ينتهِ فلا يُهلَك بعد. */
export function lastCompletedMonth(today: string): string {
  const [y, m] = today.slice(0, 7).split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

export function monthsDue(args: {
  startMonth: string;
  endMonth: string;
  today: string;
}): string[] {
  const last = lastCompletedMonth(args.today);
  // نهاية الجدول تحدّ المدى: الأصل يُهلَك مدّته ثم يتوقّف.
  const upto = args.endMonth < last ? args.endMonth : last;
  if (upto < args.startMonth) return [];
  return monthsBetween(args.startMonth, upto);
}
