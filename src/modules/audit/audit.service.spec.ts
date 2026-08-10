import { AuditService } from './audit.service';

/**
 * اختبارات قواعد التدقيق ببيانات مُصطنعة (بلا قاعدة بيانات).
 * تُحقن مستودعات وهمية تُرجع مصفوفات ثابتة — لا اتصال ولا كتابة.
 */
const makeSvc = (invoices: any[], payments: any[]) =>
  new AuditService(
    { find: async () => invoices } as any,
    { find: async () => payments } as any,
  );

const inv = (o: Partial<any>) => ({
  id: o.id || 'i1', invoice_number: o.invoice_number || 'INV-1',
  supplier_id: 's1', supplier: { name: o.supplierName || 'Supplier A' },
  vessel_id: o.vessel_id === undefined ? 'v1' : o.vessel_id,
  vessel: o.vessel_id === null ? null : { name: 'Vessel A' },
  currency: o.currency || 'USD', total_amount: o.total_amount ?? 1000,
  paid_amount: o.paid_amount ?? 0, status: o.status || 'unpaid',
  approval_status: o.approval_status ?? null, description: o.description || '', notes: o.notes || '',
  payments: o.payments || [],
});
const pay = (o: Partial<any>) => ({
  id: o.id || 'p1', invoice_id: o.invoice_id || 'i1', amount: o.amount ?? 100,
  currency: o.currency || 'USD', payment_date: o.payment_date || '2026-01-01',
  reference: o.reference ?? null, invoice: o.invoice === undefined ? null : o.invoice,
});

const has = (res: any, key: string) => res.findings.some((f: any) => f.ruleKey === key);
const countOf = (res: any, key: string) => res.findings.filter((f: any) => f.ruleKey === key).length;

describe('AuditService — قواعد الكشف', () => {
  it('1. فاتورة مدفوعة بلا أي سجل سداد', async () => {
    const res = await makeSvc([inv({ status: 'paid', paid_amount: 1000, payments: [] })], []).run();
    expect(has(res, 'paid_without_payments')).toBe(true);
    expect(res.findings.find((f: any) => f.ruleKey === 'paid_without_payments')!.exposure).toBe(1000);
  });

  it('2+4. المسدَّد أكبر من الإجمالي ⇒ زيادة سداد ومتبقٍ سالب', async () => {
    const p = pay({ amount: 1200 });
    const res = await makeSvc([inv({ paid_amount: 1200, status: 'paid', payments: [p] })], [p]).run();
    expect(has(res, 'overpaid')).toBe(true);
    expect(has(res, 'negative_remaining')).toBe(true);
  });

  it('3. المسدَّد المخزَّن سالب على فاتورة موجبة', async () => {
    const res = await makeSvc([inv({ paid_amount: -50 })], []).run();
    expect(has(res, 'negative_paid_amount')).toBe(true);
  });

  it('5. سداد يتيم (فاتورته غير موجودة)', async () => {
    const res = await makeSvc([], [pay({ amount: 500, invoice: null })]).run();
    expect(has(res, 'orphan_payment')).toBe(true);
    expect(res.findings.find((f: any) => f.ruleKey === 'orphan_payment')!.exposure).toBe(500);
  });

  it('6. تصنيف التكرار: عالٍ بنفس المرجع، متوسط بنفس التاريخ، منخفض بخلاف ذلك', async () => {
    const hi = [pay({ id: 'a', amount: 300, reference: 'TRX-9', payment_date: '2026-01-01' }),
                pay({ id: 'b', amount: 300, reference: 'TRX-9', payment_date: '2026-02-01' })];
    expect(has(await makeSvc([inv({ payments: hi })], hi).run(), 'duplicate_payment_high')).toBe(true);

    const md = [pay({ id: 'a', amount: 300, payment_date: '2026-01-01' }),
                pay({ id: 'b', amount: 300, payment_date: '2026-01-01' })];
    expect(has(await makeSvc([inv({ payments: md })], md).run(), 'duplicate_payment_medium')).toBe(true);

    const lo = [pay({ id: 'a', amount: 300, payment_date: '2026-01-01' }),
                pay({ id: 'b', amount: 300, payment_date: '2026-05-05' })];
    expect(has(await makeSvc([inv({ payments: lo })], lo).run(), 'duplicate_payment_low')).toBe(true);
  });

  it('6b. سدادان مختلفا المبلغ ليسا تكراراً', async () => {
    const ps = [pay({ id: 'a', amount: 300 }), pay({ id: 'b', amount: 400 })];
    const res = await makeSvc([inv({ payments: ps })], ps).run();
    expect(countOf(res, 'duplicate_payment_high') + countOf(res, 'duplicate_payment_medium') + countOf(res, 'duplicate_payment_low')).toBe(0);
  });

  it('7+8. عملة السداد مخالفة ⇒ لا تدخل مجموع الفاتورة ولا تُجمع مع عملتها', async () => {
    const p = pay({ amount: 1000, currency: 'EUR' });
    const res = await makeSvc([inv({ currency: 'USD', paid_amount: 1000, status: 'paid', payments: [p] })], [p]).run();
    expect(has(res, 'payment_currency_mismatch')).toBe(true);
    const mismatch = res.findings.find((f: any) => f.ruleKey === 'paid_amount_mismatch')!;
    expect(mismatch.actualPaymentsSum).toBe(0); // سداد اليورو لا يُحتسب ضمن فاتورة الدولار
  });

  it('8. المخزَّن ≠ مجموع السدادات الفعلية', async () => {
    const p = pay({ amount: 400 });
    const res = await makeSvc([inv({ paid_amount: 1000, payments: [p] })], [p]).run();
    const f = res.findings.find((x: any) => x.ruleKey === 'paid_amount_mismatch')!;
    expect(f.storedPaidAmount).toBe(1000);
    expect(f.actualPaymentsSum).toBe(400);
    expect(f.exposure).toBe(600);
  });

  it('10+11. سداد صفري وسداد سالب', async () => {
    const res = await makeSvc([], [pay({ id: 'z', amount: 0 }), pay({ id: 'n', amount: -20 })]).run();
    expect(has(res, 'zero_payment')).toBe(true);
    expect(has(res, 'negative_payment')).toBe(true);
  });

  it('12. فاتورة بلا مركب', async () => {
    const res = await makeSvc([inv({ vessel_id: null })], []).run();
    expect(has(res, 'invoice_without_vessel')).toBe(true);
  });

  it('13. approval_status=paid بلا دليل سداد', async () => {
    const res = await makeSvc([inv({ approval_status: 'paid', paid_amount: 1000, status: 'paid', payments: [] })], []).run();
    const f = res.findings.find((x: any) => x.ruleKey === 'approval_paid_no_evidence')!;
    expect(f.exposure).toBe(1000);
  });

  it('14. مغطّاة بالكامل لكن غير مُعلَّمة مدفوعة', async () => {
    const p = pay({ amount: 1000 });
    const res = await makeSvc([inv({ paid_amount: 1000, status: 'unpaid', payments: [p] })], [p]).run();
    expect(has(res, 'fully_paid_not_marked')).toBe(true);
  });

  it('15. مورد بعملتين = مؤشّر رقابي (منخفض) بلا تعرُّض مالي', async () => {
    const res = await makeSvc([
      inv({ id: 'i1', invoice_number: 'A', currency: 'USD' }),
      inv({ id: 'i2', invoice_number: 'B', currency: 'EUR' }),
    ], []).run();
    const f = res.findings.find((x: any) => x.ruleKey === 'supplier_currency_mixing')!;
    expect(f.severity).toBe('low');       // ليس خطأً مالياً بذاته
    expect(f.exposure).toBe(0);
    expect(res.mixedCurrencySuppliers.length).toBe(1);
  });

  it('15b. يُصعَّد إلى «مرتفع» عند دليل خلط فعلي (عملة سداد تخالف الفاتورة)', async () => {
    const p = pay({ amount: 100, currency: 'EUR' }); // سداد يورو على فاتورة دولار
    const res = await makeSvc([
      inv({ id: 'i1', invoice_number: 'A', currency: 'USD', payments: [p] }),
      inv({ id: 'i2', invoice_number: 'B', currency: 'EUR' }),
    ], [p]).run();
    const f = res.findings.find((x: any) => x.ruleKey === 'supplier_currency_mixing')!;
    expect(f.severity).toBe('high');
  });

  it('نفس الفاتورة تضرب عدة قواعد ⇒ صف واحد في أعلى التعرّضات يسرد كل القواعد', async () => {
    const res = await makeSvc([inv({ status: 'paid', paid_amount: 1000, approval_status: 'paid', payments: [] })], []).run();
    expect(res.topExposures.length).toBe(1);
    expect(res.topExposures[0].netExposure).toBe(1000);            // لا تكرار
    expect(res.topExposures[0].rulesTriggered.length).toBeGreaterThan(1); // كل القواعد معروضة
    expect(res.topExposures[0].severity).toBe('critical');
  });

  it('الإشعار الدائن (فاتورة سالبة) لا يُبلَّغ كزيادة سداد ولا متبقٍ سالب', async () => {
    const res = await makeSvc([inv({ invoice_number: 'CN-1', total_amount: -583, paid_amount: -583, status: 'paid', payments: [] })], []).run();
    expect(has(res, 'overpaid')).toBe(false);
    expect(has(res, 'negative_remaining')).toBe(false);
    expect(res.negativeAmounts.invoices.total).toBe(1);
    expect(res.negativeAmounts.invoices.byClass.credit_note).toBe(1);
  });

  it('لا تُجمع العملات في أي إجمالي تعرُّض', async () => {
    const res = await makeSvc([
      inv({ id: 'i1', invoice_number: 'A', currency: 'USD', status: 'paid', paid_amount: 100, payments: [] }),
      inv({ id: 'i2', invoice_number: 'B', currency: 'EUR', status: 'paid', paid_amount: 200, payments: [] }),
    ], []).run();
    expect(res.summary.exposureByCurrency.USD).toBe(100);
    expect(res.summary.exposureByCurrency.EUR).toBe(200);
    expect((res.summary.exposureByCurrency as any).TOTAL).toBeUndefined();
  });

  it('التعرُّض الصافي لا يُحتسب مرتين عندما تُطلق فاتورة واحدة عدة قواعد', async () => {
    // فاتورة واحدة تُطلق «مدفوعة بلا سداد» + «المخزَّن ≠ الفعلي» لنفس الـ1000
    const res = await makeSvc([inv({ status: 'paid', paid_amount: 1000, payments: [] })], []).run();
    expect(res.findings.filter((f: any) => f.exposure > 0).length).toBeGreaterThan(1);
    expect(res.summary.exposureByCurrency.USD).toBe(1000);       // صافٍ
    expect(res.summary.exposureByCurrencyRaw.USD).toBe(2000);    // خام (للمقارنة فقط)
  });

  it('فاتورة سليمة تماماً لا تُنتج أي ملاحظة', async () => {
    const p = pay({ amount: 1000, invoice: {} });
    const res = await makeSvc([inv({ paid_amount: 1000, status: 'paid', payments: [p] })], [p]).run();
    expect(res.findings.length).toBe(0);
    expect(res.summary.invoicesWithDiscrepancies).toBe(0);
  });

  it('الوضع للقراءة فقط ويُعلن ذلك صراحةً', async () => {
    const res = await makeSvc([], []).run();
    expect(res.mode).toBe('read-only');
  });
});
