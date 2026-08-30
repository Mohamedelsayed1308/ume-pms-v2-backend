import { accrueInterest, principalAt, yearDays, type ParentMove, type InterestTerm } from './stone-interest';

/**
 * ── محرّك الفائدة ──
 *
 * يحسب رقماً على مالٍ حقيقيٍّ بين شركةٍ أمٍّ وتابعتها. فكلُّ فرعٍ فيه مُختبَرٌ
 * بالسنت — ولا سيّما الفروع التي تقول **«لا فائدة»**، فهي أخطر من التي تحسب:
 * رقمٌ يظهر حيث لا شرطَ متّفقٌ عليه يصير إقراراً بدَينٍ لم يُوقَّع.
 */
describe('الرصيد القائم من الأصل', () => {
  const moves: ParentMove[] = [
    { occurred_at: '2025-01-10', direction: 'funding', kind: 'principal', amount_usd: 100000 },
    { occurred_at: '2025-03-01', direction: 'funding', kind: 'principal', amount_usd: 50000 },
    { occurred_at: '2025-06-01', direction: 'repayment', kind: 'principal', amount_usd: 30000 },
    // فائدةٌ مسدَّدة — لا تمسّ الأصل
    { occurred_at: '2025-06-15', direction: 'repayment', kind: 'interest', amount_usd: 4000 },
  ];

  it('يجمع التغذيات ويطرح سدادات الأصل', () => {
    expect(principalAt(moves, '2025-12-31')).toBe(120000);
  });

  it('يتوقّف عند التاريخ المطلوب ولا يستبق', () => {
    expect(principalAt(moves, '2025-01-09')).toBe(0);
    expect(principalAt(moves, '2025-01-10')).toBe(100000);
    expect(principalAt(moves, '2025-05-31')).toBe(150000);
  });

  /*
   * الفائدة لا تُنقص الأصل.
   *
   * خلطُهما يجعل «كم بقي من رأس المال؟» سؤالاً بلا جواب — ويُظهر المديونيّة
   * أقلّ ممّا هي.
   */
  it('سدادُ فائدةٍ لا يُغيّر الأصل', () => {
    expect(principalAt(moves, '2025-06-14')).toBe(120000);
    expect(principalAt(moves, '2025-06-16')).toBe(120000);
  });
});

describe('أساس أيّام السنة', () => {
  it('ACT/360 و ACT/365 وما لا يُعرف', () => {
    expect(yearDays('ACT/360')).toBe(360);
    expect(yearDays('ACT/365')).toBe(365);
    expect(yearDays('act/360')).toBe(360);
    expect(yearDays('شيءٌ آخر')).toBe(365);
  });
});

describe('الاستحقاق — الفروع التي تقول «لا فائدة»', () => {
  const moves: ParentMove[] = [
    { occurred_at: '2025-01-01', direction: 'funding', kind: 'principal', amount_usd: 100000 },
  ];

  /*
   * أخطر فرعٍ في الملفّ.
   *
   * لا شرطَ مُدخَل ⇒ `hasTerms = false` ⇒ الشاشة تقول «لا فائدةَ مُتّفقٌ عليها».
   * ولو ردّ صفراً بلا هذا العلم، لقُرئ الصفرُ إقراراً بأنّ الفائدة حُسبت
   * فكانت صفراً — وهذا غير أنّها غير موجودة.
   */
  it('بلا شروطٍ إطلاقاً ⇒ لا حساب ولا ادّعاء', () => {
    const r = accrueInterest(moves, [], '2026-01-01');
    expect(r.hasTerms).toBe(false);
    expect(r.agreed).toBe(false);
    expect(r.slices).toHaveLength(0);
    expect(r.accrued).toBe(0);
    expect(r.principalOutstanding).toBe(100000);
  });

  it('ما قبل بدء الشرط لا فائدةَ فيه — غياباً لا صفراً بالحساب', () => {
    const terms: InterestTerm[] = [{ effective_from: '2026-01-01', rate_pct: 5, day_count: 'ACT/365', is_agreed: true }];
    const r = accrueInterest(moves, terms, '2025-12-31');
    expect(r.hasTerms).toBe(true);
    expect(r.slices).toHaveLength(0);
    expect(r.accrued).toBe(0);
  });

  it('نسبةُ صفرٍ لا تُنتج شريحة', () => {
    const terms: InterestTerm[] = [{ effective_from: '2025-01-01', rate_pct: 0, day_count: 'ACT/365', is_agreed: true }];
    expect(accrueInterest(moves, terms, '2025-12-31').accrued).toBe(0);
  });

  it('رصيدٌ صفرٌ لا يُنتج فائدة', () => {
    const paid: ParentMove[] = [
      ...moves,
      { occurred_at: '2025-01-01', direction: 'repayment', kind: 'principal', amount_usd: 100000 },
    ];
    const terms: InterestTerm[] = [{ effective_from: '2025-01-01', rate_pct: 5, day_count: 'ACT/365', is_agreed: true }];
    expect(accrueInterest(paid, terms, '2025-12-31').accrued).toBe(0);
  });

  /*
   * شرطٌ غير موقَّع يُحسب — ويُعلَن أنّه غير موقَّع.
   *
   * فالمالك يريد أن يرى الأثر قبل أن يوقّع، والعلم هو ما يمنع أن يُقرأ التقدير
   * التزاماً.
   */
  it('شرطٌ غير مُتّفقٍ عليه يُحسب ويُوسَم', () => {
    const terms: InterestTerm[] = [{ effective_from: '2025-01-01', rate_pct: 5, day_count: 'ACT/365', is_agreed: false }];
    const r = accrueInterest(moves, terms, '2025-12-31');
    expect(r.hasTerms).toBe(true);
    expect(r.agreed).toBe(false);
    expect(r.accrued).toBeGreaterThan(0);
  });
});

describe('الاستحقاق — الحساب بالسنت', () => {
  /*
   * سنةٌ كاملةٌ على رصيدٍ ثابت.
   * ١٠٠٬٠٠٠ × ٥٪ × ٣٦٥/٣٦٥ = ٥٬٠٠٠ بالضبط.
   */
  it('سنةٌ كاملة على رصيدٍ ثابت', () => {
    const moves: ParentMove[] = [
      { occurred_at: '2025-01-01', direction: 'funding', kind: 'principal', amount_usd: 100000 },
    ];
    const terms: InterestTerm[] = [{ effective_from: '2025-01-01', rate_pct: 5, day_count: 'ACT/365', is_agreed: true }];
    const r = accrueInterest(moves, terms, '2025-12-31');
    expect(r.slices).toHaveLength(1);
    expect(r.slices[0].days).toBe(365);
    expect(r.accrued).toBe(5000);
  });

  it('ACT/360 يُنتج أكثر من ACT/365 على المدّة نفسها', () => {
    const moves: ParentMove[] = [
      { occurred_at: '2025-01-01', direction: 'funding', kind: 'principal', amount_usd: 100000 },
    ];
    const a = accrueInterest(moves, [{ effective_from: '2025-01-01', rate_pct: 5, day_count: 'ACT/365', is_agreed: true }], '2025-12-31');
    const b = accrueInterest(moves, [{ effective_from: '2025-01-01', rate_pct: 5, day_count: 'ACT/360', is_agreed: true }], '2025-12-31');
    expect(b.accrued).toBeGreaterThan(a.accrued);
    // ٣٦٥/٣٦٠ من الأولى
    expect(b.accrued).toBeCloseTo(5000 * 365 / 360, 2);
  });

  /*
   * الرصيد يتغيّر في المنتصف ⇒ شريحتان، لا متوسّط.
   *
   * ١٠٠٬٠٠٠ لِـ٣١ يوماً، ثمّ ١٥٠٬٠٠٠ لِـ٢٨. والمتوسّطُ يُخطئ لأنّ المدّتين
   * غير متساويتين.
   */
  it('تغيّرُ الرصيد يقطع شريحةً جديدة', () => {
    const moves: ParentMove[] = [
      { occurred_at: '2025-01-01', direction: 'funding', kind: 'principal', amount_usd: 100000 },
      { occurred_at: '2025-02-01', direction: 'funding', kind: 'principal', amount_usd: 50000 },
    ];
    const terms: InterestTerm[] = [{ effective_from: '2025-01-01', rate_pct: 6, day_count: 'ACT/365', is_agreed: true }];
    const r = accrueInterest(moves, terms, '2025-02-28');
    expect(r.slices).toHaveLength(2);
    expect(r.slices[0]).toMatchObject({ days: 31, principal: 100000 });
    expect(r.slices[1]).toMatchObject({ days: 28, principal: 150000 });
    const expected = (100000 * 0.06 * 31) / 365 + (150000 * 0.06 * 28) / 365;
    expect(r.accrued).toBeCloseTo(expected, 2);
  });

  it('تغيّرُ النسبة يقطع شريحةً كذلك', () => {
    const moves: ParentMove[] = [
      { occurred_at: '2025-01-01', direction: 'funding', kind: 'principal', amount_usd: 100000 },
    ];
    const terms: InterestTerm[] = [
      { effective_from: '2025-01-01', rate_pct: 4, day_count: 'ACT/365', is_agreed: true },
      { effective_from: '2025-07-01', rate_pct: 6, day_count: 'ACT/365', is_agreed: true },
    ];
    const r = accrueInterest(moves, terms, '2025-12-31');
    expect(r.slices).toHaveLength(2);
    expect(r.slices[0].rate_pct).toBe(4);
    expect(r.slices[1].rate_pct).toBe(6);
    expect(r.slices[0].days + r.slices[1].days).toBe(365);
  });

  it('المسدَّد من الفائدة يُطرح من المستحقّ', () => {
    const moves: ParentMove[] = [
      { occurred_at: '2025-01-01', direction: 'funding', kind: 'principal', amount_usd: 100000 },
      { occurred_at: '2025-06-30', direction: 'repayment', kind: 'interest', amount_usd: 2000 },
    ];
    const terms: InterestTerm[] = [{ effective_from: '2025-01-01', rate_pct: 5, day_count: 'ACT/365', is_agreed: true }];
    const r = accrueInterest(moves, terms, '2025-12-31');
    expect(r.accrued).toBe(5000);
    expect(r.paid).toBe(2000);
    expect(r.outstanding).toBe(3000);
  });
});

describe('الاستحقاق — على أرقام الجولة السابعة', () => {
  /*
   * التغذيات الاثنتا عشرة الحقيقيّة، بمجموع 1,138,750.
   *
   * والغرض ليس رقماً بعينه — بل أنّ المحرّك يبتلع اثنتي عشرة حركةً بتواريخ
   * متفرّقةٍ فيُخرج شرائح متّصلةً تُغطّي المدّة كلَّها بلا فجوةٍ ولا تداخل.
   */
  const R7: ParentMove[] = [
    ['2025-04-05', 100000], ['2025-05-15', 50000], ['2025-05-28', 50000],
    ['2025-07-09', 90000], ['2025-07-24', 80000], ['2025-08-16', 70000],
    ['2025-07-23', 50000], ['2025-11-19', 75000], ['2025-12-16', 90000],
    ['2026-01-20', 231250], ['2026-02-04', 140000], ['2026-03-03', 112500],
  ].map(([occurred_at, amount_usd]) => ({
    occurred_at: occurred_at as string,
    direction: 'funding' as const, kind: 'principal' as const,
    amount_usd: amount_usd as number,
  }));

  it('الرصيد القائم يساوي مجموع الشرائح', () => {
    expect(principalAt(R7, '2026-08-28')).toBe(1138750);
  });

  it('الشرائح متّصلةٌ بلا فجوةٍ ولا تداخل', () => {
    const terms: InterestTerm[] = [{ effective_from: '2025-04-05', rate_pct: 5, day_count: 'ACT/365', is_agreed: false }];
    const r = accrueInterest(R7, terms, '2026-08-28');
    expect(r.slices.length).toBeGreaterThan(1);
    for (let i = 1; i < r.slices.length; i++) {
      const prevEnd = Date.parse(`${r.slices[i - 1].to}T00:00:00Z`);
      const thisFrom = Date.parse(`${r.slices[i].from}T00:00:00Z`);
      expect(thisFrom - prevEnd).toBe(86400000);   // اليوم التالي تماماً
    }
    expect(r.slices[r.slices.length - 1].to).toBe('2026-08-28');
    expect(r.agreed).toBe(false);     // لا شرطَ موقَّعٌ بعد
  });
});
