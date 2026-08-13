import { createHash } from 'crypto';
import { BadRequestException, UnprocessableEntityException } from '@nestjs/common';
import { round2 } from '../accounting-posting';

/**
 * ── الإهلاك الشهري — منطق خالص ──
 *
 * لا مستند مصدر للإهلاك، و`source_id` عمود UUID. فيُشتقّ **معرّف حتمي** من
 * المركب والشهر: نفس المركب في نفس الشهر يعطي نفس المعرّف دائماً، فيمنع فهرس
 * التكرار القائم إهلاك شهرٍ مرّتين — بلا جدول جديد ولا فحص تطبيقي يُلتَفّ عليه.
 */

/** UUID v5 — اشتقاق حتمي بمعيار RFC 4122، لا رقم عشوائي ولا تجزئة مبتورة. */
export function deterministicUuid(namespace: string, name: string): string {
  const ns = Buffer.from(namespace.replace(/-/g, ''), 'hex');
  if (ns.length !== 16) throw new BadRequestException('نطاق المعرّف غير صالح');
  const h = createHash('sha1').update(Buffer.concat([ns, Buffer.from(name, 'utf8')])).digest();
  const b = Buffer.from(h.subarray(0, 16));
  b[6] = (b[6] & 0x0f) | 0x50; // النسخة 5
  b[8] = (b[8] & 0x3f) | 0x80; // النوع
  const s = b.toString('hex');
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
}

export interface DepreciationMonth {
  month: string;        // YYYY-MM
  accounting_date: string; // آخر يوم في الشهر
  amount: number;
  source_id: string;
  source_reference: string;
}

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

/** آخر يوم في الشهر — بحساب تقويمي لا بجدول أطوال أشهر يُخطئ في فبراير. */
export function lastDayOfMonth(month: string): string {
  if (!MONTH.test(month)) throw new BadRequestException(`شهر غير صالح: ${month} — الصيغة YYYY-MM`);
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m, 0));
  return d.toISOString().slice(0, 10);
}

/** الأشهر بين تاريخين شاملةً طرفيها. */
export function monthsBetween(from: string, to: string): string[] {
  if (!MONTH.test(from) || !MONTH.test(to)) throw new BadRequestException('الصيغة YYYY-MM مطلوبة');
  if (from > to) throw new BadRequestException('بداية المدى بعد نهايته');
  const out: string[] = [];
  let [y, m] = from.split('-').map(Number);
  const [ty, tm] = to.split('-').map(Number);
  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    if (++m > 12) { m = 1; y++; }
    if (out.length > 240) throw new BadRequestException('المدى يتجاوز عشرين سنة');
  }
  return out;
}

export function planDepreciation(args: {
  vesselId: string;
  from: string;
  to: string;
  monthlyAmount: number;
  namespace: string;
}): DepreciationMonth[] {
  const amount = round2(args.monthlyAmount);
  if (!(amount > 0)) throw new BadRequestException('القسط الشهري يجب أن يكون موجباً');
  return monthsBetween(args.from, args.to).map((month) => ({
    month,
    accounting_date: lastDayOfMonth(month),
    amount,
    source_id: deterministicUuid(args.namespace, `depreciation:${args.vesselId}:${month}`),
    source_reference: `DEP-${month}`,
  }));
}

/**
 * الأصل لا يُهلَك تحت الصفر.
 *
 * بلا سجل أصول، الحارس الوحيد المتاح هو الدفتر نفسه: التكلفة ناقص مجمّع الإهلاك
 * هو أقصى ما يبقى قابلاً للإهلاك. وتجاوزه يُنتج أصلاً برصيد سالب — خطأ لا يظهر
 * في ميزان المراجعة لأنه يظلّ متوازناً.
 */
export function assertWithinCarryingAmount(args: {
  costEur: number;
  accumulatedEur: number;
  chargeEur: number;
}): void {
  const remaining = round2(args.costEur - args.accumulatedEur);
  if (remaining <= 0) {
    throw new UnprocessableEntityException('الأصل مُهلَك بالكامل — لا يقبل إهلاكاً إضافياً');
  }
  if (round2(args.chargeEur) > remaining + 0.005) {
    throw new UnprocessableEntityException(
      `الإهلاك المطلوب (${round2(args.chargeEur).toFixed(2)}) يتجاوز الصافي الدفتري المتبقّي (${remaining.toFixed(2)})`);
  }
}
