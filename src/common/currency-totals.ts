// تجميع مالي آمن للعملات — لا يُجمع مبلغان بعملتين مختلفتين أبداً.
// أي إجمالي موحّد يتطلب سعر صرف وتاريخاً ومصدراً موثّقاً، وهو خارج نطاق هذه الطبقة.

export interface CurrencyTotals {
  currency: string;
  invoiced: number;
  paid: number;                 // المخزَّن — يبقى كما هو للتوافق الرجعي
  outstanding: number;
  invoiceCount: number;
  // ── R3A · فصل مصدر الإغلاق ────────────────────────────────────────────────
  // «كم دفعنا داخل PMS؟» و«كم أُغلق بتسوية سابقة للنظام؟» سؤالان مختلفان.
  // مشتقّان بالكامل — لا عمود مالي جديد في قاعدة البيانات.
  //   paid = paidViaPms + settledPreSystem + creditNoteOffset + unevidencedResidual
  // والمتبقّي (unevidencedResidual) هو بالضبط ما يجب أن يبقى حرِجاً في التدقيق.
  paidViaPms: number;           // مجموع سجلات السداد الفعلية داخل PMS
  settledPreSystem: number;     // مغلق بتسوية موثَّقة سابقة للنظام — ليس دفعة PMS
  creditNoteOffset: number;     // إشعارات دائنة — تخفّض التزاماً ولا تمثّل سداداً
  unevidencedResidual: number;  // مُعلَّم مدفوعاً بلا سند ولا تصنيف ⇒ يستوجب تدقيقاً
}

// ملخّص قديم للتوافق الرجعي فقط: أرقام حقيقية لعملة واحدة، وnull عند التعدّد.
export interface LegacyTotals {
  currency: string | null;
  mixed_currency: boolean;
  total_invoiced: number | null;
  total_paid: number | null;
  total_outstanding: number | null;
}

export const normalizeCurrency = (c?: string | null) => (c || 'USD').trim().toUpperCase();
export const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * يجمّع فواتير في دفاتر مستقلة لكل عملة.
 * الفاتورة بمبلغ سالب (إشعار دائن) تبقى في عملتها ولا تُعكس إشارتها.
 */
export function totalsByCurrency(
  rows: {
    currency?: string | null; total_amount: any; paid_amount: any;
    settlement_basis?: string | null;                 // R3A — اختياري: الغياب يعني غير مصنَّف
    payments?: { amount: any; currency?: string | null }[] | null;
  }[],
): CurrencyTotals[] {
  const map = new Map<string, CurrencyTotals>();
  for (const r of rows) {
    const c = normalizeCurrency(r.currency);
    let t = map.get(c);
    if (!t) {
      t = { currency: c, invoiced: 0, paid: 0, outstanding: 0, invoiceCount: 0,
            paidViaPms: 0, settledPreSystem: 0, creditNoteOffset: 0, unevidencedResidual: 0 };
      map.set(c, t);
    }
    t.invoiced = round2(t.invoiced + Number(r.total_amount || 0));
    const stored = Number(r.paid_amount || 0);
    t.paid = round2(t.paid + stored);
    t.invoiceCount++;

    // السداد الفعلي داخل PMS — بعملة الفاتورة حصراً، فلا خلط عملات
    const viaPms = (r.payments || [])
      .filter((p) => normalizeCurrency(p.currency) === c)
      .reduce((s, p) => s + Number(p.amount || 0), 0);
    t.paidViaPms = round2(t.paidViaPms + viaPms);

    // الباقي بعد السداد الفعلي يُنسب لمصدره المصنَّف، وإلا يبقى بلا دليل
    const rest = round2(stored - viaPms);
    if (Math.abs(rest) > 0.005) {
      if (r.settlement_basis === 'pre_system_settled') t.settledPreSystem = round2(t.settledPreSystem + rest);
      else if (r.settlement_basis === 'credit_note') t.creditNoteOffset = round2(t.creditNoteOffset + rest);
      else t.unevidencedResidual = round2(t.unevidencedResidual + rest);
    }
  }
  for (const t of map.values()) t.outstanding = round2(t.invoiced - t.paid);
  return [...map.values()].sort((a, b) => a.currency.localeCompare(b.currency));
}

/**
 * الحقول القديمة: تُملأ بأرقام حقيقية لمورد/مركب أحادي العملة فقط.
 * عند التعدّد تُرجع null مع mixed_currency: true — ولا تحمل مجموع عملات إطلاقاً.
 */
export function legacyTotals(list: CurrencyTotals[]): LegacyTotals {
  if (list.length === 1) {
    const t = list[0];
    return {
      currency: t.currency, mixed_currency: false,
      total_invoiced: t.invoiced, total_paid: t.paid, total_outstanding: t.outstanding,
    };
  }
  return {
    currency: null, mixed_currency: list.length > 1,
    total_invoiced: null, total_paid: null, total_outstanding: null,
  };
}
