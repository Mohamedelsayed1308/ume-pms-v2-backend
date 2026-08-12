import {
  round2, prepareLines, assertBalanced, totalsByCurrency, assertDateInPeriod,
  assertPeriodAcceptsPosting, resolveBackdating, formatEntryNo, assertCanEditDraft,
  assertCanPost, assertCanReverse, buildReversalLines, assertReversalDate,
  AccountRef, FxRateRef, PrepareContext, PeriodRef, LineInput,
} from './accounting-posting';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * P1.1A — اختبارات تركيبية · بيانات مُصطنعة بالكامل
 *
 * ⚠️ لا يلمس أي اختبار هنا قاعدة بيانات ولا بيانات إنتاج. المعرّفات ثابتة
 *    ومُختلَقة، والمبالغ لا تخصّ أي مورّد أو مركب حقيقي.
 * ═══════════════════════════════════════════════════════════════════════════
 */

const LE = 'le-0001';
const OTHER_LE = 'le-9999';

const acct = (id: string, over: Partial<AccountRef> = {}): AccountRef => ({
  id, legal_entity_id: LE, is_active: true, is_postable: true,
  currency_restriction: null, code: id, name: id, ...over,
});

const ACC = new Map<string, AccountRef>([
  ['a-bank', acct('a-bank')],
  ['a-exp', acct('a-exp')],
  ['a-ap', acct('a-ap')],
  ['a-header', acct('a-header', { is_postable: false })],
  ['a-off', acct('a-off', { is_active: false })],
  ['a-eur-only', acct('a-eur-only', { currency_restriction: 'EUR' })],
  ['a-foreign', acct('a-foreign', { legal_entity_id: OTHER_LE })],
]);

const fx = (id: string, over: Partial<FxRateRef> = {}): FxRateRef => ({
  id, legal_entity_id: LE, currency_from: 'USD', currency_to: 'EUR',
  rate: 0.9, rate_date: '2026-03-10', source: 'ECB', approved_by: null, ...over,
});

const FX = new Map<string, FxRateRef>([
  ['fx-usd', fx('fx-usd')],
  ['fx-future', fx('fx-future', { rate_date: '2026-12-31' })],
  ['fx-manual-unapproved', fx('fx-manual-unapproved', { source: 'MANUAL_APPROVED' })],
  ['fx-manual-approved', fx('fx-manual-approved', { source: 'MANUAL_APPROVED', approved_by: 'u-1' })],
  ['fx-wrong-pair', fx('fx-wrong-pair', { currency_from: 'SAR' })],
  ['fx-other-entity', fx('fx-other-entity', { legal_entity_id: OTHER_LE })],
  ['fx-functional', fx('fx-functional', { source: 'FUNCTIONAL' })],
]);

const ctx = (over: Partial<PrepareContext> = {}): PrepareContext => ({
  legal_entity_id: LE,
  functional_currency: 'EUR',
  accounting_date: '2026-03-15',
  accounts: ACC,
  fxRates: FX,
  ...over,
});

const eurPair = (amount: number): LineInput[] => ([
  { account_id: 'a-exp', debit: amount, transaction_currency: 'EUR' },
  { account_id: 'a-ap', credit: amount, transaction_currency: 'EUR' },
]);

const period = (over: Partial<PeriodRef> = {}): PeriodRef => ({
  id: 'p-3', legal_entity_id: LE, fiscal_year_id: 'fy-2026', period_no: 3,
  name: '2026-03', start_date: '2026-03-01', end_date: '2026-03-31', status: 'open', ...over,
});

// ═══ 1 · التقريب النقدي ═══════════════════════════════════════════════════
describe('P1.1A · التقريب النقدي', () => {
  it('1. يقرّب نصف القرش لأعلى دون انحراف الفاصلة العائمة', () => {
    expect(round2(1.005)).toBe(1.01);
    expect(round2(2.675)).toBe(2.68);
    expect(round2(0.1 + 0.2)).toBe(0.3);
  });
});

// ═══ 2 · بنية القيد ═══════════════════════════════════════════════════════
describe('P1.1A · بنية القيد', () => {
  it('2. يرفض قيداً بسطر واحد', () => {
    expect(() => prepareLines(
      [{ account_id: 'a-exp', debit: 100, transaction_currency: 'EUR' }], ctx(),
    )).toThrow(/سطرين على الأقل/);
  });

  it('3. يرفض سطراً مديناً ودائناً معاً', () => {
    expect(() => prepareLines([
      { account_id: 'a-exp', debit: 100, credit: 50, transaction_currency: 'EUR' },
      { account_id: 'a-ap', credit: 50, transaction_currency: 'EUR' },
    ], ctx())).toThrow(/مديناً أو دائناً/);
  });

  it('4. يرفض سطراً صفرياً — لا يمرّ بوصفه بريئاً', () => {
    expect(() => prepareLines([
      { account_id: 'a-exp', debit: 0, credit: 0, transaction_currency: 'EUR' },
      { account_id: 'a-ap', credit: 100, transaction_currency: 'EUR' },
    ], ctx())).toThrow(/مديناً أو دائناً/);
  });

  it('5. يرفض المبلغ السالب — الاتجاه بالمدين والدائن لا بالإشارة', () => {
    expect(() => prepareLines([
      { account_id: 'a-exp', debit: -100, transaction_currency: 'EUR' },
      { account_id: 'a-ap', credit: 100, transaction_currency: 'EUR' },
    ], ctx())).toThrow(/سالبة/);
  });

  it('6. يرفض كسور أقل من القرش بدل ابتلاعها بالتقريب', () => {
    expect(() => prepareLines([
      { account_id: 'a-exp', debit: 100.001, transaction_currency: 'EUR' },
      { account_id: 'a-ap', credit: 100.001, transaction_currency: 'EUR' },
    ], ctx())).toThrow(/أقل من القرش/);
  });
});

// ═══ 3 · الحسابات ═════════════════════════════════════════════════════════
describe('P1.1A · ضوابط الحساب', () => {
  it('7. يرفض الترحيل على حساب تجميعي', () => {
    expect(() => prepareLines([
      { account_id: 'a-header', debit: 100, transaction_currency: 'EUR' },
      { account_id: 'a-ap', credit: 100, transaction_currency: 'EUR' },
    ], ctx())).toThrow(/تجميعي/);
  });

  it('8. يرفض الحساب غير النشط', () => {
    expect(() => prepareLines([
      { account_id: 'a-off', debit: 100, transaction_currency: 'EUR' },
      { account_id: 'a-ap', credit: 100, transaction_currency: 'EUR' },
    ], ctx())).toThrow(/غير نشط/);
  });

  it('9. يمنع خلط الكيانات القانونية في قيد واحد', () => {
    expect(() => prepareLines([
      { account_id: 'a-foreign', debit: 100, transaction_currency: 'EUR' },
      { account_id: 'a-ap', credit: 100, transaction_currency: 'EUR' },
    ], ctx())).toThrow(/كياناً قانونياً آخر/);
  });

  it('10. يحترم تقييد الحساب بعملة واحدة', () => {
    expect(() => prepareLines([
      { account_id: 'a-eur-only', debit: 100, transaction_currency: 'USD', fx_rate_id: 'fx-usd' },
      { account_id: 'a-ap', credit: 90, transaction_currency: 'EUR' },
    ], ctx())).toThrow(/مقيَّد بعملة EUR/);
  });

  it('11. يرفض حساباً غير موجود', () => {
    expect(() => prepareLines([
      { account_id: 'a-ghost', debit: 100, transaction_currency: 'EUR' },
      { account_id: 'a-ap', credit: 100, transaction_currency: 'EUR' },
    ], ctx())).toThrow(/غير موجود/);
  });
});

// ═══ 4 · العملات وأسعار الصرف ═════════════════════════════════════════════
describe('P1.1A · نزاهة العملة', () => {
  it('12. اليورو سعره واحد ومصدره FUNCTIONAL دائماً', () => {
    const p = prepareLines(eurPair(100), ctx());
    expect(p.lines.every((l) => l.fx_rate === 1 && l.fx_source === 'FUNCTIONAL')).toBe(true);
    expect(p.lines.every((l) => l.fx_rate_id === null)).toBe(true);
  });

  it('13. يرفض إسناد سعر صرف لسطر باليورو', () => {
    expect(() => prepareLines([
      { account_id: 'a-exp', debit: 100, transaction_currency: 'EUR', fx_rate_id: 'fx-usd' },
      { account_id: 'a-ap', credit: 100, transaction_currency: 'EUR' },
    ], ctx())).toThrow(/لا يُسنَد سعر صرف/);
  });

  it('14. يرفض عملة أجنبية بلا سعر معتمَد — لا تحويل ضمني', () => {
    expect(() => prepareLines([
      { account_id: 'a-exp', debit: 100, transaction_currency: 'USD' },
      { account_id: 'a-ap', credit: 90, transaction_currency: 'EUR' },
    ], ctx())).toThrow(/بلا سعر صرف معتمَد/);
  });

  it('15. ينسخ السعر من الصف المعتمد ولا يقبله من الطلب', () => {
    const p = prepareLines([
      { account_id: 'a-exp', debit: 100, transaction_currency: 'USD', fx_rate_id: 'fx-usd' },
      { account_id: 'a-ap', credit: 90, transaction_currency: 'EUR' },
    ], ctx());
    expect(p.lines[0].fx_rate).toBe(0.9);
    expect(p.lines[0].fx_date).toBe('2026-03-10');
    expect(p.lines[0].fx_source).toBe('ECB');
    expect(p.lines[0].debit_eur).toBe(90);
  });

  it('16. يرفض سعراً لاحقاً لتاريخ القيد — لا تقييم بمعلومة لم تكن متاحة', () => {
    expect(() => prepareLines([
      { account_id: 'a-exp', debit: 100, transaction_currency: 'USD', fx_rate_id: 'fx-future' },
      { account_id: 'a-ap', credit: 90, transaction_currency: 'EUR' },
    ], ctx())).toThrow(/بعد تاريخ القيد/);
  });

  it('17. يرفض السعر اليدوي بلا معتمِد ويقبله باعتماد', () => {
    const bad: LineInput[] = [
      { account_id: 'a-exp', debit: 100, transaction_currency: 'USD', fx_rate_id: 'fx-manual-unapproved' },
      { account_id: 'a-ap', credit: 90, transaction_currency: 'EUR' },
    ];
    expect(() => prepareLines(bad, ctx())).toThrow(/بلا اعتماد/);
    const good = prepareLines([
      { ...bad[0], fx_rate_id: 'fx-manual-approved' }, bad[1],
    ], ctx());
    expect(good.lines[0].fx_source).toBe('MANUAL_APPROVED');
  });

  it('18. يرفض سعراً لزوج عملات مختلف أو لكيان آخر أو بمصدر FUNCTIONAL', () => {
    const mk = (id: string): LineInput[] => ([
      { account_id: 'a-exp', debit: 100, transaction_currency: 'USD', fx_rate_id: id },
      { account_id: 'a-ap', credit: 90, transaction_currency: 'EUR' },
    ]);
    expect(() => prepareLines(mk('fx-wrong-pair'), ctx())).toThrow(/لا يطابق عملة السطر/);
    expect(() => prepareLines(mk('fx-other-entity'), ctx())).toThrow(/كياناً قانونياً آخر/);
    expect(() => prepareLines(mk('fx-functional'), ctx())).toThrow(/FUNCTIONAL لا يصلح/);
  });

  it('19. لا يجمع عملتين في إجمالي واحد — الإجماليات مفصولة بالعملة', () => {
    const p = prepareLines([
      { account_id: 'a-exp', debit: 100, transaction_currency: 'USD', fx_rate_id: 'fx-usd' },
      { account_id: 'a-ap', credit: 90, transaction_currency: 'EUR' },
    ], ctx());
    const t = totalsByCurrency(p.lines);
    expect(t.USD).toEqual({ debit: 100, credit: 0 });
    expect(t.EUR).toEqual({ debit: 0, credit: 90 });
    expect(Object.keys(t).sort()).toEqual(['EUR', 'USD']);
  });

  it('20. يرفض عملة وظيفية غير EUR في P1.1A بدل افتراضها ضمناً', () => {
    expect(() => prepareLines(eurPair(100), ctx({ functional_currency: 'USD' })))
      .toThrow(/EUR فقط/);
  });
});

// ═══ 5 · التوازن ══════════════════════════════════════════════════════════
describe('P1.1A · التوازن', () => {
  it('21. يقبل القيد المتوازن باليورو', () => {
    const p = prepareLines(eurPair(1234.56), ctx());
    expect(p.total_debit_eur).toBe(1234.56);
    expect(() => assertBalanced(p)).not.toThrow();
  });

  it('22. يقبل التوازن باليورو رغم اختلاف عملات المعاملة', () => {
    const p = prepareLines([
      { account_id: 'a-exp', debit: 100, transaction_currency: 'USD', fx_rate_id: 'fx-usd' },
      { account_id: 'a-ap', credit: 90, transaction_currency: 'EUR' },
    ], ctx());
    expect(() => assertBalanced(p)).not.toThrow();
    expect(p.total_debit_eur).toBe(90);
  });

  it('23. يرفض غير المتوازن — ولا يسدّ الفرق بسطر مُختلَق', () => {
    const p = prepareLines([
      { account_id: 'a-exp', debit: 100, transaction_currency: 'EUR' },
      { account_id: 'a-ap', credit: 99.99, transaction_currency: 'EUR' },
    ], ctx());
    expect(() => assertBalanced(p)).toThrow(/غير متوازن/);
  });

  it('24. يرفض فرق تقريب التحويل بدل إخفائه — التوازن تامّ لا تقريبي', () => {
    const FX2 = new Map(FX);
    FX2.set('fx-odd', fx('fx-odd', { rate: 0.333333 }));
    const p = prepareLines([
      { account_id: 'a-exp', debit: 10, transaction_currency: 'USD', fx_rate_id: 'fx-odd' },
      { account_id: 'a-bank', debit: 10, transaction_currency: 'USD', fx_rate_id: 'fx-odd' },
      { account_id: 'a-ap', credit: 20, transaction_currency: 'USD', fx_rate_id: 'fx-odd' },
    ], ctx({ fxRates: FX2 }));
    // 3.33 + 3.33 ≠ 6.67 — الفرق قرش واحد يُرفض صراحةً
    expect(p.total_debit_eur).toBe(6.66);
    expect(p.total_credit_eur).toBe(6.67);
    expect(() => assertBalanced(p)).toThrow(/فرق -0.01/);
  });

  it('25. يرفض مبلغاً يؤول إلى صفر باليورو بعد التحويل', () => {
    const FX3 = new Map(FX);
    FX3.set('fx-tiny', fx('fx-tiny', { rate: 0.0001 }));
    expect(() => prepareLines([
      { account_id: 'a-exp', debit: 0.01, transaction_currency: 'USD', fx_rate_id: 'fx-tiny' },
      { account_id: 'a-ap', credit: 0.01, transaction_currency: 'USD', fx_rate_id: 'fx-tiny' },
    ], ctx({ fxRates: FX3 }))).toThrow(/يؤول إلى صفر/);
  });
});

// ═══ 6 · الفترات والتواريخ ════════════════════════════════════════════════
describe('P1.1A · الفترة والتاريخ', () => {
  it('26. يرفض تاريخاً خارج حدود الفترة', () => {
    expect(() => assertDateInPeriod('2026-04-01', period())).toThrow(/خارج الفترة/);
    expect(() => assertDateInPeriod('2026-03-31', period())).not.toThrow();
  });

  it('27. الفترة المفتوحة تقبل كل الأحداث', () => {
    for (const t of ['manual', 'adjustment', 'invoice_accrual', 'reversal']) {
      expect(() => assertPeriodAcceptsPosting(period(), t)).not.toThrow();
    }
  });

  it('28. الإقفال المبدئي يقبل التسوية والعكس ويرفض الحركة العادية', () => {
    const p = period({ status: 'soft_closed' });
    expect(() => assertPeriodAcceptsPosting(p, 'adjustment')).not.toThrow();
    expect(() => assertPeriodAcceptsPosting(p, 'reversal')).not.toThrow();
    expect(() => assertPeriodAcceptsPosting(p, 'manual')).toThrow(/مُقفلة مبدئياً/);
  });

  it('29. الإقفال النهائي يرفض كل شيء بلا استثناء', () => {
    const p = period({ status: 'hard_closed' });
    for (const t of ['manual', 'adjustment', 'reversal', 'opening_balance']) {
      expect(() => assertPeriodAcceptsPosting(p, t)).toThrow(/نهائياً/);
    }
  });

  it('30. القيد بأثر رجعي يلزمه سبب مكتوب ويُوسَم', () => {
    expect(() => resolveBackdating('2026-03-01', '2026-03-15', null)).toThrow(/سبباً مكتوباً/);
    expect(() => resolveBackdating('2026-03-01', '2026-03-15', '   ')).toThrow(/سبباً مكتوباً/);
    expect(resolveBackdating('2026-03-01', '2026-03-15', 'مستند متأخر'))
      .toEqual({ is_backdated: true, backdated_reason: 'مستند متأخر' });
    expect(resolveBackdating('2026-03-15', '2026-03-15', null))
      .toEqual({ is_backdated: false, backdated_reason: null });
  });
});

// ═══ 7 · الترقيم ══════════════════════════════════════════════════════════
describe('P1.1A · الترقيم الرسمي', () => {
  it('31. يبني رقماً متسلسلاً مبطَّناً بالأصفار', () => {
    expect(formatEntryNo('GJ', 2026, 1)).toBe('GJ-2026-00001');
    expect(formatEntryNo('GJ', 2026, 12345)).toBe('GJ-2026-12345');
  });

  it('32. يرفض بادئة أو تسلسلاً غير صالح', () => {
    expect(() => formatEntryNo('', 2026, 1)).toThrow();
    expect(() => formatEntryNo('gj lower', 2026, 1)).toThrow();
    expect(() => formatEntryNo('GJ', 2026, 0)).toThrow(/تسلسل/);
  });
});

// ═══ 8 · دورة الحياة ══════════════════════════════════════════════════════
describe('P1.1A · دورة حياة القيد', () => {
  it('33. لا يُعدَّل قيد مُرحَّل ولا ملغى', () => {
    expect(() => assertCanEditDraft('draft')).not.toThrow();
    expect(() => assertCanEditDraft('posted')).toThrow(/قيد عكسي/);
    expect(() => assertCanEditDraft('reversed')).toThrow(/قيد عكسي/);
    expect(() => assertCanEditDraft('void')).toThrow(/ملغى/);
  });

  it('34. لا يُرحَّل إلا المسوّدة — ولا يُرحَّل المُرحَّل مرتين', () => {
    expect(() => assertCanPost('draft')).not.toThrow();
    expect(() => assertCanPost('posted')).toThrow(/بالفعل/);
    expect(() => assertCanPost('reversed')).toThrow(/بالفعل/);
    expect(() => assertCanPost('void')).toThrow(/ملغى/);
  });

  it('35. لا يُعكس إلا المُرحَّل، ولا يُعكس مرتين', () => {
    expect(() => assertCanReverse({ status: 'posted', reversed_by_entry_id: null })).not.toThrow();
    expect(() => assertCanReverse({ status: 'draft' })).toThrow(/مُرحَّل/);
    expect(() => assertCanReverse({ status: 'reversed' })).toThrow(/معكوس بالفعل/);
    expect(() => assertCanReverse({ status: 'posted', reversed_by_entry_id: 'x' }))
      .toThrow(/معكوس بالفعل/);
  });

  it('36. العكس يبدّل الاتجاه ويحتفظ بسعر الصرف الأصلي — بلا فرق عملة مُختلَق', () => {
    const p = prepareLines([
      { account_id: 'a-exp', debit: 100, transaction_currency: 'USD', fx_rate_id: 'fx-usd' },
      { account_id: 'a-ap', credit: 90, transaction_currency: 'EUR' },
    ], ctx());
    const r = buildReversalLines(p.lines);
    expect(r[0].debit).toBe(0);
    expect(r[0].credit).toBe(100);
    expect(r[0].credit_eur).toBe(90);
    expect(r[0].fx_rate).toBe(p.lines[0].fx_rate);
    expect(r[0].fx_date).toBe(p.lines[0].fx_date);
    expect(r[0].fx_rate_id).toBe(p.lines[0].fx_rate_id);
    // الأثر الصافي صفر: القيد وعكسه معاً لا يتركان رصيداً
    const net = p.lines.concat(r).reduce((s, l) => round2(s + l.debit_eur - l.credit_eur), 0);
    expect(net).toBe(0);
  });

  it('37. تاريخ العكس لا يسبق الأصل', () => {
    expect(() => assertReversalDate('2026-03-15', '2026-03-14')).toThrow(/لا يجوز أن يسبق/);
    expect(() => assertReversalDate('2026-03-15', '2026-03-15')).not.toThrow();
    expect(() => assertReversalDate('2026-03-15', '2026-04-01')).not.toThrow();
  });

  it('38. العكس يبقى متوازناً بعد التبديل', () => {
    const p = prepareLines(eurPair(777.77), ctx());
    const r = buildReversalLines(p.lines);
    const td = r.reduce((s, l) => round2(s + l.debit_eur), 0);
    const tc = r.reduce((s, l) => round2(s + l.credit_eur), 0);
    expect(td).toBe(tc);
  });
});
