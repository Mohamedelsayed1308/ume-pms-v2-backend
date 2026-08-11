import { BadRequestException } from '@nestjs/common';

/**
 * بيانات التحكّم المالي — تحدّد ما إذا كانت الفاتورة مغلقة مالياً ولماذا.
 *
 * تعديلها يحوّل ملاحظة تدقيق حرجة إلى معلوماتية، أي يُخفي فاتورة مُعلَّمة «مدفوعة»
 * بلا سند دفع. لذلك لا تُكتب من أي مسار فواتير عادي مهما كانت صلاحية المستخدم.
 *
 * المسار الشرعي الوحيد: الهجرة المعتمدة (أو لاحقاً نقطة نهاية admin مخصّصة بأثر مسجَّل).
 *
 * لا يُعتمد على إخفائها في الواجهة — الحماية خادمية بالكامل.
 */
export const FINANCIAL_CONTROL_FIELDS = ['data_origin', 'settlement_basis', 'import_batch_id'] as const;

/**
 * الطبقة 1 — رفض عند الحدّ.
 * الرفض لا التجريد الصامت: محاولة الكتابة إشارة رقابية يجب أن تُرى، لا أن تُبتلع.
 */
export function rejectFinancialControlFields(body: any): void {
  if (!body || typeof body !== 'object') return;
  const found = FINANCIAL_CONTROL_FIELDS.filter((f) => f in body);
  if (found.length) {
    throw new BadRequestException(
      `الحقول التالية بيانات تحكّم مالي ولا تُكتب من مسارات الفواتير: ${found.join(', ')}. ` +
      'تُعدَّل حصراً عبر هجرة معتمدة.',
    );
  }
}

/**
 * الطبقة 2 — تجريد في الخدمة.
 * تحمي أي مسار مستقبلي ينسى الطبقة 1. تُعيد كائناً جديداً ولا تُعدّل الأصل.
 */
export function stripFinancialControlFields<T extends Record<string, any>>(data: T): T {
  if (!data || typeof data !== 'object') return data;
  const clean: Record<string, any> = { ...data };
  for (const f of FINANCIAL_CONTROL_FIELDS) delete clean[f];
  // الكائن المرتبط يفتح نفس الباب عبر التتالي — يُجرَّد أيضاً
  delete clean.import_batch;
  return clean as T;
}
