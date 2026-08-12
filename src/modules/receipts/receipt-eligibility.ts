/**
 * ── أهلية الاستحقاق من زاوية الاستلام ──
 *
 * دالّة صافية بلا قاعدة بيانات: القرار يُختبر بمعزل عن أي بنية تحتية، وهو
 * القرار الذي يقرّر ما يدخل الدفتر وما لا يدخل.
 *
 * المبدأ المعتمَد: **الفاتورة تُثبت المطالبة لا الاستلام**، وأمر الشراء يُثبت
 * الطلب لا التسليم. فالسلع تحتاج واقعة استلام مسجَّلة. أما الخدمة ذات الفترة
 * فدليلها فترتها نفسها متى انقضت — ولا يُطلب لها إذن استلام لا وجود له أصلاً.
 */

export const RECEIPT_TYPES = ['GOODS_RECEIVED', 'SERVICE_CONFIRMED', 'MANAGEMENT_RECEIPT_CONFIRMATION'] as const;
export type ReceiptType = (typeof RECEIPT_TYPES)[number];

/** التصنيف حكمٌ بشري لا يُستنتج من حقل — فيُمرَّر ولا يُخمَّن. */
export type AccrualCategory = 'GOODS' | 'PERIOD_SERVICE';

/** الحالة التشغيلية التي تصرّح بغياب التسليم. ليست قاعدة محاسبية بل شهادة نفي. */
export const DELIVERY_MISSING = 'delivery_missing';

export interface ReceiptRecord {
  receipt_type: ReceiptType;
  received_date: string;
}

export interface EligibilityInput {
  category: AccrualCategory;
  approval_status?: string | null;
  receipts?: ReceiptRecord[];
  /** فترة الخدمة كما يثبتها المستند — لا كما تُفترض. */
  service_period_end?: string | null;
  /** تاريخ تقييم الأهلية. الفترة التي لم تنقضِ بعد لا تُستحقّ كاملة. */
  as_of?: string;
}

export interface EligibilityVerdict {
  eligible: boolean;
  reason: string;
  basis: 'RECEIPT_RECORD' | 'SERVICE_PERIOD_ELAPSED' | 'NONE';
}

const ACCEPTING = new Set<ReceiptType>(['GOODS_RECEIVED', 'SERVICE_CONFIRMED', 'MANAGEMENT_RECEIPT_CONFIRMATION']);

export function evaluateAccrualEligibility(input: EligibilityInput): EligibilityVerdict {
  const receipts = (input.receipts ?? []).filter((r) => ACCEPTING.has(r.receipt_type));

  // واقعة استلام مسجَّلة تحسم الأمر لأي تصنيف — وهي أقوى من أي استنتاج.
  if (receipts.length > 0) {
    return {
      eligible: true,
      basis: 'RECEIPT_RECORD',
      reason: `واقعة استلام مسجَّلة (${receipts[0].receipt_type} بتاريخ ${receipts[0].received_date})`,
    };
  }

  // النظام يصرّح بغياب التسليم. تصريحُ نفي لا يُتجاوز باستنتاج.
  if (input.approval_status === DELIVERY_MISSING) {
    return {
      eligible: false,
      basis: 'NONE',
      reason: 'النظام يصرّح بغياب التسليم (delivery_missing) ولا واقعة استلام تنقضه',
    };
  }

  if (input.category === 'PERIOD_SERVICE') {
    if (!input.service_period_end) {
      return {
        eligible: false,
        basis: 'NONE',
        reason: 'خدمة بفترة بلا نهاية فترة مُثبَتة في المستند — الفترة دليلها فلا تُفترض',
      };
    }
    const asOf = input.as_of ?? new Date().toISOString().slice(0, 10);
    if (input.service_period_end > asOf) {
      return {
        eligible: false,
        basis: 'NONE',
        reason: `فترة الخدمة تنتهي في ${input.service_period_end} ولم تنقضِ بعد في ${asOf}`,
      };
    }
    return {
      eligible: true,
      basis: 'SERVICE_PERIOD_ELAPSED',
      reason: `فترة الخدمة انقضت في ${input.service_period_end}`,
    };
  }

  return {
    eligible: false,
    basis: 'NONE',
    reason: 'سلعة بلا واقعة استلام — الفاتورة تُثبت المطالبة لا الاستلام، وأمر الشراء يُثبت الطلب لا التسليم',
  };
}
