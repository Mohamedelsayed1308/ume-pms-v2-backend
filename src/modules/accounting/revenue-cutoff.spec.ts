import { splitHireRevenue, summariseCutoff, HirePeriod } from './revenue-cutoff';

const JUL = ['2026-07-01', '2026-07-31'] as const;

// المشارطات الفعلية على Gubal Trader لعميلها الوحيد UME SHIPPING AB.
const HIRES: HirePeriod[] = [
  { invoice_no: 'SV-26-07-01', total: 75000, from: '2026-07-01', to: '2026-07-15' },
  { invoice_no: 'SV-26-07-02', total: 75000, from: '2026-07-16', to: '2026-07-30' },
  { invoice_no: 'SV-26-07-03', total: 75000, from: '2026-07-31', to: '2026-08-14' },
];

describe('قطع فترة إيراد الإيجار — الأساس المكتسَب', () => {
  it('1. مشارطة داخل الشهر كاملة تُستحقّ كاملة', () => {
    const r = splitHireRevenue(HIRES[0], JUL[0], JUL[1]);
    expect(r.days_total).toBe(15);
    expect(r.days_in_period).toBe(15);
    expect(r.earned).toBe(75000);
    expect(r.deferred).toBe(0);
  });

  it('2. المشارطة العابرة للشهرين تنقسم بالأيام', () => {
    const r = splitHireRevenue(HIRES[2], JUL[0], JUL[1]);
    expect(r.days_total).toBe(15);
    expect(r.days_in_period).toBe(1);
    expect(r.earned).toBe(5000);
    expect(r.deferred).toBe(70000);
  });

  it('3. إجمالي يوليو المعتمَد — 155,000 مكتسَب و 70,000 مؤجَّل', () => {
    const s = summariseCutoff(HIRES.map((h) => splitHireRevenue(h, JUL[0], JUL[1])));
    expect(s.earned).toBe(155000);
    expect(s.deferred).toBe(70000);
    expect(s.invoiced).toBe(225000);
    // المكتسَب + المؤجَّل = المفوتَر. لا يضيع سنت ولا يُخلق.
    expect(s.earned + s.deferred).toBe(s.invoiced);
  });

  it('4. الأساس المكتسَب ليس أساس تاريخ الفاتورة', () => {
    const byInvoiceDate = 225000;
    const s = summariseCutoff(HIRES.map((h) => splitHireRevenue(h, JUL[0], JUL[1])));
    expect(s.earned).not.toBe(byInvoiceDate);
    expect(byInvoiceDate - s.earned).toBe(70000);
  });

  it('5. أغسطس يستقبل ما أُجّل عنه — بلا ازدواج ولا فقد', () => {
    const aug = splitHireRevenue(HIRES[2], '2026-08-01', '2026-08-31');
    expect(aug.days_in_period).toBe(14);
    expect(aug.earned).toBe(70000);
    const jul = splitHireRevenue(HIRES[2], JUL[0], JUL[1]);
    expect(jul.earned + aug.earned).toBe(75000);
  });

  it('6. مشارطة خارج الفترة كلياً لا تُستحقّ منها شيء', () => {
    const r = splitHireRevenue(HIRES[0], '2026-09-01', '2026-09-30');
    expect(r.days_in_period).toBe(0);
    expect(r.earned).toBe(0);
    expect(r.deferred).toBe(75000);
  });
});
