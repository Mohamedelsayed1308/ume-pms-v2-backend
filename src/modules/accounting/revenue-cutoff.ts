/**
 * ── قطع فترة إيراد الإيجار ──
 *
 * الأساس المعتمَد **المكتسَب لا تاريخ الفاتورة**: فاتورة مؤرَّخة في يوليو تغطّي
 * مشارطة تمتدّ إلى أغسطس لا تكون إيراد يوليو كاملة. الجزء غير المكتسَب التزام
 * (`2300`) لا إيراد.
 */

export interface HirePeriod {
  invoice_no: string;
  total: number;
  /** أول أيام المشارطة وآخرها — شاملان. */
  from: string;
  to: string;
}

export interface CutoffResult {
  invoice_no: string;
  total: number;
  days_total: number;
  days_in_period: number;
  earned: number;
  deferred: number;
}

const DAY = 86400000;

function days(from: string, to: string): number {
  return Math.round((Date.parse(to) - Date.parse(from)) / DAY) + 1;
}

/** يوزّع فاتورة مشارطة على فترة محاسبية بحدّيها الشاملين. */
export function splitHireRevenue(h: HirePeriod, periodStart: string, periodEnd: string): CutoffResult {
  const total = days(h.from, h.to);
  if (total <= 0) throw new Error(`فترة مشارطة غير صالحة على ${h.invoice_no}`);

  const start = h.from > periodStart ? h.from : periodStart;
  const end = h.to < periodEnd ? h.to : periodEnd;
  const inside = start > end ? 0 : days(start, end);

  // التقريب على المكتسَب والمؤجَّل هو المتمّم — فلا يضيع سنت في القسمة.
  const earned = Math.round((h.total * inside / total) * 100) / 100;
  return {
    invoice_no: h.invoice_no, total: h.total,
    days_total: total, days_in_period: inside,
    earned, deferred: Math.round((h.total - earned) * 100) / 100,
  };
}

export function summariseCutoff(rows: CutoffResult[]) {
  const r2 = (n: number) => Math.round(n * 100) / 100;
  return {
    earned: r2(rows.reduce((a, r) => a + r.earned, 0)),
    deferred: r2(rows.reduce((a, r) => a + r.deferred, 0)),
    invoiced: r2(rows.reduce((a, r) => a + r.total, 0)),
  };
}
