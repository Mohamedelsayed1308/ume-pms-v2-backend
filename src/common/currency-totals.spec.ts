import { totalsByCurrency, legacyTotals, normalizeCurrency, round2 } from './currency-totals';

// بيانات صناعية بالكامل — لا قراءة ولا كتابة على الإنتاج
const iv = (currency: string, total_amount: number, paid_amount = 0) => ({ currency, total_amount, paid_amount });
const of = (list: any[], c: string) => list.find((t) => t.currency === c);

describe('1-3 · تجميع الموردين حسب العملة', () => {
  it('1. مورد بالدولار فقط', () => {
    const t = totalsByCurrency([iv('USD', 1000, 400), iv('USD', 500, 0)]);
    expect(t.length).toBe(1);
    expect(of(t, 'USD')).toMatchObject({ invoiced: 1500, paid: 400, outstanding: 1100, invoiceCount: 2 });
  });

  it('2. مورد باليورو فقط', () => {
    const t = totalsByCurrency([iv('EUR', 800, 300)]);
    expect(t.map((x) => x.currency)).toEqual(['EUR']);
    expect(of(t, 'EUR').outstanding).toBe(500);
  });

  it('3. مورد بالدولار واليورو ⇒ دفتران منفصلان', () => {
    const t = totalsByCurrency([iv('USD', 10000, 0), iv('EUR', 5000, 0)]);
    expect(t.length).toBe(2);
    expect(of(t, 'USD').outstanding).toBe(10000);
    expect(of(t, 'EUR').outstanding).toBe(5000);
    // القاعدة الحاكمة: لا يوجد 15,000 في أي مكان
    expect(t.some((x) => x.invoiced === 15000 || x.outstanding === 15000)).toBe(false);
  });
});

describe('4-7 · فصل المدفوع والمتبقي ومنع الجمع', () => {
  it('4. المدفوع والمتبقي مفصولان لكل عملة', () => {
    const t = totalsByCurrency([iv('USD', 1000, 250), iv('EUR', 400, 400)]);
    expect(of(t, 'USD')).toMatchObject({ paid: 250, outstanding: 750 });
    expect(of(t, 'EUR')).toMatchObject({ paid: 400, outstanding: 0 });
  });

  it('5. مركب بعملة واحدة', () => {
    const t = totalsByCurrency([iv('USD', 100, 50), iv('USD', 200, 100)]);
    expect(t.length).toBe(1);
    expect(of(t, 'USD').outstanding).toBe(150);
  });

  it('6. مركب بعملتين', () => {
    const t = totalsByCurrency([iv('USD', 100, 50), iv('EUR', 900, 0)]);
    expect(of(t, 'USD').outstanding).toBe(50);
    expect(of(t, 'EUR').outstanding).toBe(900);
  });

  it('7. لا يوجد أي جمع عبر العملات في أي حقل', () => {
    const t = totalsByCurrency([iv('USD', 1000, 0), iv('EUR', 500, 0), iv('SAR', 250, 0), iv('CHF', 100, 0)]);
    const all = t.flatMap((x) => [x.invoiced, x.paid, x.outstanding]);
    expect(all).not.toContain(1850);          // مجموع الأربعة
    expect(t.map((x) => x.invoiced).sort((a, b) => a - b)).toEqual([100, 250, 500, 1000]);
  });
});

describe('8-9 · العقد القديم ومنع الترتيب المختلط', () => {
  it('8. مورد داخل مركب بعملات متعددة ⇒ لا إجمالي موحّد', () => {
    const t = totalsByCurrency([iv('USD', 1000, 0), iv('EUR', 500, 0)]);
    const L = legacyTotals(t);
    expect(L.mixed_currency).toBe(true);
    expect(L.total_invoiced).toBeNull();
    expect(L.total_paid).toBeNull();
    expect(L.total_outstanding).toBeNull();
    expect(L.currency).toBeNull();
  });

  it('9. لا يوجد رقم مالي موحّد يصلح للترتيب عند تعدّد العملات', () => {
    const a = legacyTotals(totalsByCurrency([iv('USD', 10, 0), iv('EUR', 99999, 0)]));
    const b = legacyTotals(totalsByCurrency([iv('USD', 20, 0), iv('EUR', 1, 0)]));
    // كلاهما null ⇒ يستحيل بناء ترتيب مالي مختلط منهما
    expect(a.total_invoiced).toBeNull();
    expect(b.total_invoiced).toBeNull();
  });

  it('10. مورد أحادي العملة يحتفظ بالحقول القديمة صحيحة (توافق رجعي)', () => {
    const L = legacyTotals(totalsByCurrency([iv('USD', 1000, 400)]));
    expect(L).toMatchObject({ currency: 'USD', mixed_currency: false, total_invoiced: 1000, total_paid: 400, total_outstanding: 600 });
  });
});

describe('11-15 · حالات حدّية', () => {
  it('11. الفاتورة السالبة تبقى في عملتها بلا عكس إشارة', () => {
    const t = totalsByCurrency([iv('USD', 1000, 0), iv('EUR', -1775, 0), iv('EUR', -1775, 0)]);
    expect(of(t, 'USD').invoiced).toBe(1000);
    expect(of(t, 'EUR').invoiced).toBe(-3550);
    expect(of(t, 'EUR').outstanding).toBe(-3550);
    expect(of(t, 'USD').outstanding).toBe(1000);   // لم يتأثر
  });

  it('12. الأرصدة الصفرية تُعالَج بأمان', () => {
    const t = totalsByCurrency([iv('USD', 500, 500)]);
    expect(of(t, 'USD').outstanding).toBe(0);
    expect(legacyTotals(t).total_outstanding).toBe(0);
  });

  it('13. دقّة الكسور صحيحة', () => {
    const t = totalsByCurrency([iv('USD', 1000.10, 333.33), iv('USD', 0.07, 0)]);
    expect(of(t, 'USD').invoiced).toBe(1000.17);
    expect(of(t, 'USD').outstanding).toBe(666.84);
    expect(round2(0.1 + 0.2)).toBe(0.3);
  });

  it('14. نتيجة فارغة آمنة', () => {
    const t = totalsByCurrency([]);
    expect(t).toEqual([]);
    const L = legacyTotals(t);
    expect(L.mixed_currency).toBe(false);
    expect(L.total_invoiced).toBeNull();
    expect(L.currency).toBeNull();
  });

  it('15. توحيد رمز العملة ودمج الاختلافات', () => {
    expect(normalizeCurrency('usd')).toBe('USD');
    expect(normalizeCurrency(' eur ')).toBe('EUR');
    expect(normalizeCurrency(null)).toBe('USD');
    const t = totalsByCurrency([iv('usd', 100, 0), iv('USD', 50, 0), iv(' Usd ', 25, 0)]);
    expect(t.length).toBe(1);
    expect(of(t, 'USD').invoiced).toBe(175);
  });

  it('العملة الفارغة تؤول إلى USD ولا تُنشئ دفتراً مجهولاً', () => {
    const t = totalsByCurrency([{ currency: null, total_amount: 100, paid_amount: 0 } as any]);
    expect(t.map((x) => x.currency)).toEqual(['USD']);
  });

  it('الدفاتر مرتَّبة أبجدياً بشكل حتمي', () => {
    const a = totalsByCurrency([iv('USD', 1, 0), iv('CHF', 1, 0), iv('EUR', 1, 0)]).map((x) => x.currency);
    const b = totalsByCurrency([iv('EUR', 1, 0), iv('USD', 1, 0), iv('CHF', 1, 0)]).map((x) => x.currency);
    expect(a).toEqual(['CHF', 'EUR', 'USD']);
    expect(a).toEqual(b);
  });
});
