import { buildTwoSidedLines, buildSettlementLines, assertSettleable, SettlementInput } from './accounting-bridge.logic';

const ACC = { payableId: 'ap', bankId: 'bank', fxGainId: 'gain', fxLossId: 'loss' };

const settle = (over: Partial<SettlementInput> = {}): SettlementInput => ({
  amount: 1880, currency: 'USD',
  carrying: { fxRateId: 'fx-may', rate: 0.90 },
  settlement: { fxRateId: 'fx-jul', rate: 0.87 },
  accounts: ACC, ...over,
});

const eur = (l: any) => Number(l.debit ?? l.credit);

describe('جسر المستندات — قيد بسيط', () => {
  it('1. طرفان متساويان بنفس العملة', () => {
    const l = buildTwoSidedLines({ debitAccountId: 'exp', creditAccountId: 'ap', amount: 1854.50, currency: 'EUR', fxRateId: null });
    expect(l).toHaveLength(2);
    expect(l[0].debit).toBe(1854.50);
    expect(l[1].credit).toBe(1854.50);
    expect(l[0].fx_rate_id).toBeNull();
  });

  it('2. عملة أجنبية بلا سعر مرفوضة', () => {
    expect(() => buildTwoSidedLines({ debitAccountId: 'e', creditAccountId: 'a', amount: 100, currency: 'USD', fxRateId: null }))
      .toThrow(/بلا سعر صرف معتمَد/);
  });

  it('3. سعر صرف مُسنَد لليورو مرفوض', () => {
    expect(() => buildTwoSidedLines({ debitAccountId: 'e', creditAccountId: 'a', amount: 100, currency: 'EUR', fxRateId: 'x' }))
      .toThrow(/لا يُسنَد سعر صرف/);
  });

  it('4. مبلغ غير موجب مرفوض', () => {
    for (const amount of [0, -5]) {
      expect(() => buildTwoSidedLines({ debitAccountId: 'e', creditAccountId: 'a', amount, currency: 'EUR', fxRateId: null }))
        .toThrow(/موجباً/);
    }
  });

  it('5. الأبعاد تُنسَخ على الطرفين', () => {
    const l = buildTwoSidedLines({ debitAccountId: 'e', creditAccountId: 'a', amount: 10, currency: 'EUR', fxRateId: null,
      dims: { vessel_id: 'v1', supplier_id: 's1' } });
    expect(l.every((x) => x.vessel_id === 'v1' && x.supplier_id === 's1')).toBe(true);
  });
});

describe('جسر المستندات — السداد وفرق الصرف', () => {
  it('6. حالة Navtor الفعلية — مكسب 56.40', () => {
    const r = buildSettlementLines(settle());
    expect(r.carrying_eur).toBe(1692.00);
    expect(r.settlement_eur).toBe(1635.60);
    expect(r.fx_difference_eur).toBe(56.40);
    expect(r.lines).toHaveLength(3);
    expect(r.lines[2].account_id).toBe('gain');
    expect(r.lines[2].credit).toBe(56.40);
    // القيد يتوازن باليورو: الالتزام = البنك + الفرق
    expect(r.settlement_eur + r.fx_difference_eur).toBe(r.carrying_eur);
  });

  it('7. الالتزام يُقفَل بسعره الدفتري لا بسعر اليوم', () => {
    const r = buildSettlementLines(settle());
    expect(r.lines[0].fx_rate_id).toBe('fx-may');   // الدفتري
    expect(r.lines[1].fx_rate_id).toBe('fx-jul');   // يوم السداد
  });

  it('8. ارتفاع سعر العملة يُنتج خسارة على الحساب الصحيح', () => {
    const r = buildSettlementLines(settle({ settlement: { fxRateId: 'fx-jul', rate: 0.95 } }));
    expect(r.carrying_eur).toBe(1692.00);
    expect(r.settlement_eur).toBe(1786.00);
    expect(r.fx_difference_eur).toBe(-94.00);
    expect(r.lines[2].account_id).toBe('loss');
    expect(r.lines[2].debit).toBe(94.00);
    expect(r.settlement_eur - Number(r.lines[2].debit)).toBe(r.carrying_eur);
  });

  it('9. تساوي السعرين ⇒ صفر ولا سطر ثالث — لا يُصطنع فرق', () => {
    const r = buildSettlementLines(settle({ settlement: { fxRateId: 'fx-jul', rate: 0.90 } }));
    expect(r.fx_difference_eur).toBe(0);
    expect(r.lines).toHaveLength(2);
    expect(r.lines.some((l) => l.account_id === 'gain' || l.account_id === 'loss')).toBe(false);
  });

  it('10. السداد باليورو بلا أسعار ولا فرق', () => {
    const r = buildSettlementLines(settle({
      currency: 'EUR', amount: 500,
      carrying: { fxRateId: null, rate: 1 }, settlement: { fxRateId: null, rate: 1 },
    }));
    expect(r.lines).toHaveLength(2);
    expect(r.fx_difference_eur).toBe(0);
    expect(r.carrying_eur).toBe(500);
  });

  it('11. سداد جزئي — الفرق يتناسب مع المسدَّد وحده', () => {
    const half = buildSettlementLines(settle({ amount: 940 }));
    expect(half.carrying_eur).toBe(846.00);
    expect(half.settlement_eur).toBe(817.80);
    expect(half.fx_difference_eur).toBe(28.20);
    // نصف المبلغ ⇒ نصف الفرق بالضبط
    expect(half.fx_difference_eur * 2).toBe(buildSettlementLines(settle()).fx_difference_eur);
  });

  it('12. عملة أجنبية بسعر ناقص مرفوضة', () => {
    expect(() => buildSettlementLines(settle({ carrying: { fxRateId: null, rate: 0.9 } }))).toThrow(/سعرين معتمَدين/);
    expect(() => buildSettlementLines(settle({ settlement: { fxRateId: null, rate: 0.87 } }))).toThrow(/سعرين معتمَدين/);
  });

  it('13. سعر صفري أو سالب مرفوض', () => {
    expect(() => buildSettlementLines(settle({ carrying: { fxRateId: 'x', rate: 0 } }))).toThrow(/غير صالح/);
  });

  it('14. سداد باليورو بسعر صرف مُسنَد مرفوض', () => {
    expect(() => buildSettlementLines(settle({ currency: 'EUR', carrying: { fxRateId: 'x', rate: 1 } })))
      .toThrow(/لا يُسنَد سعر صرف/);
  });

  it('15. التوازن باليورو مضمون مهما كانت كسور السعر', () => {
    // أسعار بثماني خانات ومبالغ كسرية — حيث يظهر انحراف التقريب إن وُجد.
    const cases = [
      { amount: 333.33, rate: 0.87123450 },
      { amount: 0.01,   rate: 0.90000001 },
      { amount: 99999.99, rate: 0.86666667 },
      { amount: 1234.56, rate: 0.91234567 },
    ];
    for (const { amount, rate } of cases) {
      const r = buildSettlementLines(settle({ amount, settlement: { fxRateId: 'fx-jul', rate } }));
      expect(r.settlement_eur + r.fx_difference_eur).toBeCloseTo(r.carrying_eur, 2);
      // كل مبلغ مُقرَّب إلى القرش — لا كسور مخبّأة تتراكم لاحقاً
      expect(r.carrying_eur).toBe(Math.round(r.carrying_eur * 100) / 100);
      expect(r.settlement_eur).toBe(Math.round(r.settlement_eur * 100) / 100);
      expect(r.fx_difference_eur).toBe(Math.round(r.fx_difference_eur * 100) / 100);
    }
  });
});

describe('جسر المستندات — حدّ السداد', () => {
  it('16. سداد ضمن المتبقّي مقبول', () => {
    expect(() => assertSettleable(1880, 0, 1880)).not.toThrow();
    expect(() => assertSettleable(1880, 940, 940)).not.toThrow();
  });

  it('17. سداد يتجاوز المتبقّي مرفوض', () => {
    expect(() => assertSettleable(1880, 940, 941)).toThrow(/يتجاوز المتبقّي/);
    expect(() => assertSettleable(1880, 1880, 0.01)).toThrow(/يتجاوز المتبقّي/);
  });

  it('18. تفاوت أقل من نصف قرش لا يُعطّل سداداً صحيحاً', () => {
    expect(() => assertSettleable(1880, 1879.999, 0.001)).not.toThrow();
  });
});
