import { InvoicesService, normalizeCurrency, round2 } from './invoices.service';

// بيانات صناعية بالكامل — لا قراءة ولا كتابة على الإنتاج
const SUP = { id: 's1', name: 'Test Supplier' };
let seq = 0;
const inv = (o: Partial<any> = {}): any => ({
  id: 'i' + ++seq, invoice_number: 'INV-' + seq, supplier: SUP, vessel: null, purchase_order: null,
  invoice_date: '2026-01-10', created_at: '2026-01-10T00:00:00Z', updated_at: '2026-01-10T00:00:00Z',
  currency: 'USD', total_amount: 1000, paid_amount: 0, type: 'final', status: 'unpaid',
  approval_status_date: null, payments: [], ...o,
});
const pay = (o: Partial<any> = {}): any => ({
  id: 'p' + ++seq, amount: 100, currency: 'USD', payment_date: '2026-01-15',
  created_at: '2026-01-15T00:00:00Z', payment_method: 'bank_transfer', reference: null, ...o,
});

const run = (invoices: any[]) => {
  const repo: any = { find: async () => invoices };
  const svc = new InvoicesService(repo, {} as any);
  return svc.getSupplierStatement('s1');
};
const led = (r: any, c: string) => r.currencies.find((x: any) => x.currency === c);

beforeEach(() => { seq = 0; });

describe('1-4 · تجميع العملات', () => {
  it('1. مورد بالدولار فقط ⇒ دفتر واحد', async () => {
    const r = await run([inv({ currency: 'USD' })]);
    expect(r.currencies.map((c: any) => c.currency)).toEqual(['USD']);
  });

  it('2. مورد باليورو فقط ⇒ دفتر واحد', async () => {
    const r = await run([inv({ currency: 'EUR' })]);
    expect(r.currencies.map((c: any) => c.currency)).toEqual(['EUR']);
  });

  it('3. دولار + يورو ⇒ دفتران منفصلان', async () => {
    const r = await run([inv({ currency: 'USD', total_amount: 1000 }), inv({ currency: 'EUR', total_amount: 500 })]);
    expect(r.currencies.map((c: any) => c.currency).sort()).toEqual(['EUR', 'USD']);
    expect(led(r, 'USD').closingBalance).toBe(1000);
    expect(led(r, 'EUR').closingBalance).toBe(500);
  });

  it('4. ثلاث عملات ⇒ ثلاثة دفاتر', async () => {
    const r = await run([inv({ currency: 'USD' }), inv({ currency: 'EUR' }), inv({ currency: 'SAR' })]);
    expect(r.currencies.length).toBe(3);
  });
});

describe('5-8 · العزل بين الدفاتر', () => {
  it('5. فاتورة دولار تؤثر على الدولار فقط', async () => {
    const r = await run([inv({ currency: 'USD', total_amount: 700 }), inv({ currency: 'EUR', total_amount: 300 })]);
    expect(led(r, 'USD').invoicesTotal).toBe(700);
    expect(led(r, 'EUR').invoicesTotal).toBe(300);
  });

  it('6. فاتورة يورو لا تلمس الدولار', async () => {
    const r = await run([inv({ currency: 'USD', total_amount: 700 }), inv({ currency: 'EUR', total_amount: 999 })]);
    expect(led(r, 'USD').closingBalance).toBe(700);
  });

  it('7. سداد دولار يؤثر على الدولار فقط', async () => {
    const r = await run([
      inv({ currency: 'USD', total_amount: 1000, payments: [pay({ amount: 400, currency: 'USD' })] }),
      inv({ currency: 'EUR', total_amount: 500 }),
    ]);
    expect(led(r, 'USD').closingBalance).toBe(600);
    expect(led(r, 'EUR').closingBalance).toBe(500);
  });

  it('8. سداد يورو يؤثر على اليورو فقط', async () => {
    const r = await run([
      inv({ currency: 'USD', total_amount: 1000 }),
      inv({ currency: 'EUR', total_amount: 500, payments: [pay({ amount: 200, currency: 'EUR' })] }),
    ]);
    expect(led(r, 'USD').closingBalance).toBe(1000);
    expect(led(r, 'EUR').closingBalance).toBe(300);
  });
});

describe('9-10 · الإشعارات الدائنة', () => {
  it('9. إشعار دائن يقلّل الرصيد بنفس العملة (لا انعكاس إشارة)', async () => {
    const r = await run([
      inv({ currency: 'USD', total_amount: 1000, invoice_date: '2026-01-01' }),
      inv({ currency: 'USD', total_amount: -300, invoice_date: '2026-01-05' }),
    ]);
    const L = led(r, 'USD');
    expect(L.invoicesTotal).toBe(1000);
    expect(L.creditsTotal).toBe(300);     // قيمة مطلقة في خانة الدائن
    expect(L.closingBalance).toBe(700);   // 1000 − 300 (وليس 1300)
  });

  it('9b. الإشعار الدائن يُقيَّد دائناً لا مديناً سالباً', async () => {
    const r = await run([inv({ currency: 'USD', total_amount: -500 })]);
    const t = led(r, 'USD').transactions[0];
    expect(t.type).toBe('credit');
    expect(t.kind).toBe('credit_note');
    expect(t.credit).toBe(500);
    expect(t.debit).toBe(0);
    expect(led(r, 'USD').closingBalance).toBe(-500);
  });

  it('10. إشعار دائن باليورو لا يمسّ الدولار', async () => {
    const r = await run([
      inv({ currency: 'USD', total_amount: 1000 }),
      inv({ currency: 'EUR', total_amount: -400 }),
    ]);
    expect(led(r, 'USD').closingBalance).toBe(1000);
    expect(led(r, 'USD').creditsTotal).toBe(0);
    expect(led(r, 'EUR').creditsTotal).toBe(400);
  });
});

describe('11-13 · الأرصدة والترتيب', () => {
  it('11. الرصيد الافتتاحي مفصول لكل عملة (0 — لا فترة زمنية)', async () => {
    const r = await run([inv({ currency: 'USD' }), inv({ currency: 'EUR' })]);
    expect(r.currencies.every((c: any) => c.openingBalance === 0)).toBe(true);
  });

  it('12. الرصيد المتراكم داخل العملة فقط', async () => {
    const r = await run([
      inv({ currency: 'USD', total_amount: 100, invoice_date: '2026-01-01' }),
      inv({ currency: 'EUR', total_amount: 900, invoice_date: '2026-01-02' }),
      inv({ currency: 'USD', total_amount: 50, invoice_date: '2026-01-03' }),
    ]);
    expect(led(r, 'USD').transactions.map((t: any) => t.balance)).toEqual([100, 150]);
    expect(led(r, 'EUR').transactions.map((t: any) => t.balance)).toEqual([900]);
  });

  it('13. حركات نفس اليوم مرتّبة ترتيباً حتمياً', async () => {
    const build = () => [
      inv({ id: 'zzz', invoice_number: 'Z', currency: 'USD', total_amount: 10, invoice_date: '2026-01-01', created_at: '2026-01-01T10:00:00Z' }),
      inv({ id: 'aaa', invoice_number: 'A', currency: 'USD', total_amount: 20, invoice_date: '2026-01-01', created_at: '2026-01-01T09:00:00Z' }),
    ];
    seq = 0; const r1 = await run(build());
    seq = 0; const r2 = await run(build().reverse());
    const ids = (r: any) => led(r, 'USD').transactions.map((t: any) => t.id);
    expect(ids(r1)).toEqual(ids(r2));                       // نفس الترتيب مهما كان ترتيب الإدخال
    expect(led(r1, 'USD').transactions.map((t: any) => t.balance)).toEqual([20, 30]); // الأقدم إنشاءً أولاً
  });
});

describe('14-20 · حالات حدّية وسلامة', () => {
  it('14. لا تُنتَج مجموعة عملة فارغة', async () => {
    const r = await run([inv({ currency: 'USD' })]);
    expect(r.currencies.length).toBe(1);
    expect(r.currencies.every((c: any) => c.transactions.length > 0)).toBe(true);
  });

  it('15. مورد أحادي العملة يحتفظ بالحقل القديم صحيحاً', async () => {
    const r = await run([inv({ currency: 'USD', total_amount: 1000, payments: [pay({ amount: 250 })] })]);
    expect(r.summary.currency).toBe('USD');
    expect(r.summary.mixed_currency).toBe(false);
    expect(r.summary.balance).toBe(750);
  });

  it('16. لا يوجد أي جمع عبر العملات في أي إجمالي', async () => {
    const r = await run([
      inv({ currency: 'USD', total_amount: 1000 }),
      inv({ currency: 'EUR', total_amount: 500 }),
      inv({ currency: 'SAR', total_amount: 250 }),
    ]);
    // الحقل القديم يُصفَّر ويُعلَّم عند التعدّد — لا رقم موحّد
    expect(r.summary.balance).toBe(0);
    expect(r.summary.currency).toBeNull();
    expect(r.summary.mixed_currency).toBe(true);
    const sum = r.currencies.reduce((s: number, c: any) => s + c.closingBalance, 0);
    expect(sum).toBe(1750);                                   // فقط للتوضيح — غير معروض في أي مخرج
    expect(Object.keys(r.summary_by_currency).sort()).toEqual(['EUR', 'SAR', 'USD']);
  });

  it('17. مورد بلا حركات ⇒ نتيجة فارغة آمنة', async () => {
    const r = await run([]);
    expect(r.supplier).toBeNull();
    expect(r.currencies).toEqual([]);
    expect(r.transactions).toEqual([]);
    expect(r.summary.balance).toBe(0);
    expect(r.summary.mixed_currency).toBe(false);
  });

  it('18. دقّة الكسور محفوظة', async () => {
    const r = await run([
      inv({ currency: 'USD', total_amount: 1000.10, payments: [pay({ amount: 333.33 })] }),
      inv({ currency: 'USD', total_amount: 0.07 }),
    ]);
    expect(led(r, 'USD').closingBalance).toBe(666.84);        // 1000.10 − 333.33 + 0.07
    expect(round2(0.1 + 0.2)).toBe(0.3);
  });

  it('19. الفاتورة السالبة لا تُحدث انعكاس إشارة', async () => {
    const r = await run([
      inv({ currency: 'USD', total_amount: 1000, invoice_date: '2026-01-01' }),
      inv({ currency: 'USD', total_amount: -1000, invoice_date: '2026-01-02' }),
    ]);
    expect(led(r, 'USD').closingBalance).toBe(0);             // متعادل، لا 2000
  });

  it('20. توحيد رمز العملة', () => {
    expect(normalizeCurrency('usd')).toBe('USD');
    expect(normalizeCurrency(' eur ')).toBe('EUR');
    expect(normalizeCurrency(null)).toBe('USD');
    expect(normalizeCurrency('')).toBe('USD');
  });

  it('سداد بعملة تخالف الفاتورة يبقى في دفتر عملته (بلا تحويل)', async () => {
    const r = await run([inv({ currency: 'USD', total_amount: 1000, payments: [pay({ amount: 200, currency: 'EUR' })] })]);
    expect(led(r, 'USD').closingBalance).toBe(1000);          // لم يُخصم منه شيء
    expect(led(r, 'EUR').closingBalance).toBe(-200);          // قُيِّد في دفتر اليورو
  });

  it('كل حركة تحمل الحقول المطلوبة', async () => {
    const r = await run([inv({ currency: 'USD', payments: [pay()] })]);
    for (const t of led(r, 'USD').transactions) {
      for (const f of ['date', 'type', 'reference', 'invoiceId', 'invoiceNumber', 'description', 'debit', 'credit', 'balance', 'currency']) {
        expect(t).toHaveProperty(f);
      }
    }
  });
});
