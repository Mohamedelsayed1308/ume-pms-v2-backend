// تجميع مالي آمن للعملات — لا يُجمع مبلغان بعملتين مختلفتين أبداً.
// أي إجمالي موحّد يتطلب سعر صرف وتاريخاً ومصدراً موثّقاً، وهو خارج نطاق هذه الطبقة.

export interface CurrencyTotals {
  currency: string;
  invoiced: number;
  paid: number;
  outstanding: number;
  invoiceCount: number;
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
  rows: { currency?: string | null; total_amount: any; paid_amount: any }[],
): CurrencyTotals[] {
  const map = new Map<string, CurrencyTotals>();
  for (const r of rows) {
    const c = normalizeCurrency(r.currency);
    let t = map.get(c);
    if (!t) { t = { currency: c, invoiced: 0, paid: 0, outstanding: 0, invoiceCount: 0 }; map.set(c, t); }
    t.invoiced = round2(t.invoiced + Number(r.total_amount || 0));
    t.paid = round2(t.paid + Number(r.paid_amount || 0));
    t.invoiceCount++;
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
