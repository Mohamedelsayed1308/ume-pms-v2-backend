import Decimal from 'decimal.js';
import {
  compareWithReported, computeEntry, convert, crossRate, entitlementDays, proRata, rateLabel, signOffDay, signOffDayApplies, totalsByCurrency,
  type EntryInput, type FxMonth,
} from './crew-salary.calc';

/** كما يخزّنه جدول الأسعار: مقلوب المدخَل بخمسة عشر رقماً معنويّاً ثمّ رقمٌ عشريّ. */
const stored = (usdPerUnit: string) => String(new Decimal(1).div(usdPerUnit).toSignificantDigits(15).toNumber());
const fxAt = (usdPerUnit: string): FxMonth => ({ month: '2026-08', perUsd: { EUR: stored(usdPerUnit) } });

/*
 * أرقام هذه الاختبارات مأخوذةٌ من عيّنة أغسطس ٢٠٢٦ **بلا أسماءٍ ولا أرقام هويّة** —
 * المرتّبات والتواريخ وحدها، لإثبات القاعدة لا لحفظ بيانات البحّارة.
 */
const base = (over: Partial<EntryInput> = {}): EntryInput => ({
  month: '2026-08', currency: 'EUR', payStart: '2026-08-01', payEnd: '2026-08-31',
  signsOffThisMonth: false, rates: { basic: '1697', fixed_ot: '679', leave: '424' }, extras: [], ...over,
});

describe('أيّام الاستحقاق', () => {
  it.each([
    ['2026-08', '2026-08-01', '2026-08-31', 30, 'full_month'],
    ['2026-08', '2026-08-06', '2026-08-31', 26, 'partial'],
    ['2026-08', '2026-08-01', '2026-08-20', 20, 'partial'],
    ['2026-08', '2026-08-20', '2026-08-31', 12, 'partial'],
    ['2026-08', '2026-08-01', '2026-08-06', 6, 'partial'],
    ['2026-08', '2026-08-02', '2026-08-31', 30, 'partial'],   // ٣٠ يوماً فعليّة في شهر ٣١
    ['2026-02', '2026-02-01', '2026-02-28', 30, 'full_month'], // فبراير الكامل = ٣٠
    ['2026-09', '2026-09-01', '2026-09-30', 30, 'full_month'],
  ])('%s  %s → %s = %i', (m, s, e, days, rule) => {
    expect(entitlementDays(m, s, e)).toMatchObject({ days, rule });
  });
});

describe('البنود الشهريّة: الشهريّ ÷ ٣٠ × الأيّام، وكلّ بندٍ يُقرَّب قبل الجمع', () => {
  it('عيّنة ٢٦ يوماً: 1636/655/409 ⇒ 1417.87 / 567.67 / 354.47', () => {
    expect(proRata('1636', 26)).toBe('1417.87');
    expect(proRata('655', 26)).toBe('567.67');
    expect(proRata('409', 26)).toBe('354.47');
  });
  it('عيّنة ٢٠ يوماً: 1697 ⇒ 1131.33 · و١٢ يوماً ⇒ 678.80', () => {
    expect(proRata('1697', 20)).toBe('1131.33');
    expect(proRata('1697', 12)).toBe('678.80');
  });
  it('لا أخطاء الفاصلة العائمة: 0.1 × 3 ÷ 30 × 30', () => {
    expect(proRata('0.3', 30)).toBe('0.30');
  });
  it('التقريب بندٌ بندٌ لا على المجموع', () => {
    // 1/30×1 = 0.0333… ⇒ 0.03 لكلٍّ من الثلاثة ⇒ 0.09 (لا 0.10)
    const r = computeEntry(base({ rates: { basic: '1', fixed_ot: '1', leave: '1' }, payStart: '2026-08-01', payEnd: '2026-08-01' }), null);
    expect(r.earnings).toBe('0.09');
  });
  it('الشهر الكامل: الشهريّ كما هو', () => {
    const r = computeEntry(base(), null);
    expect(r.items.map((i) => i.amount)).toEqual(['1697.00', '679.00', '424.00']);
    expect(r.balance).toBe('2800.00');
    expect(r.complete).toBe(true);
  });
});

describe('يوم النزول الإضافيّ: (الأساسيّ + الإضافيّ الثابت) ÷ ٣٠ بلا بدل الإجازة', () => {
  it('الحالة ١: نزولٌ بعد ٢٠ يوماً ⇒ 79.20 (والمُصدَّر 93.33 يشمل الإجازة ⇒ فرق 14.13 يظهر للمراجعة)', () => {
    expect(signOffDay('1697', '679')).toBe('79.20');
    const r = computeEntry(base({ payEnd: '2026-08-20', signsOffThisMonth: true }), null);
    const day = r.items.find((i) => i.kind === 'sign_off_day')!;
    expect(day.amount).toBe('79.20');
    expect(day.days).toBe(1);
    expect(r.days).toBe(20);
    const diffs = compareWithReported(r, [
      { kind: 'basic', amount: '1131.33' }, { kind: 'fixed_ot', amount: '452.67' }, { kind: 'leave', amount: '282.67' },
      { kind: 'sign_off_day', amount: '93.33' }, { kind: 'cash_advance', amount: '200' },
    ], '1760');
    expect(diffs).toEqual([
      { kind: 'sign_off_day', calculated: '79.20', reported: '93.33', diff: '-14.13' },
      { kind: 'cash_advance', calculated: null, reported: '200.00', diff: '-200.00' },
      { kind: 'balance', calculated: '1945.87', reported: '1760.00', diff: '185.87' },
    ]);
  });
  it('الحالة ٢: نزولٌ بعد ٦ أيّام بمرتّب 6060/2425/1515 ⇒ 282.83 (والمُصدَّر 333.33 ⇒ فرق 50.50)', () => {
    // 1212/485/303 لستّة أيّام ⇒ الشهريّ 6060/2425/1515
    const r = computeEntry(base({ rates: { basic: '6060', fixed_ot: '2425', leave: '1515' }, payEnd: '2026-08-06', signsOffThisMonth: true }), null);
    expect(r.items.slice(0, 3).map((i) => i.amount)).toEqual(['1212.00', '485.00', '303.00']);
    expect(r.items.find((i) => i.kind === 'sign_off_day')!.amount).toBe('282.83');
    const d = compareWithReported(r, [{ kind: 'sign_off_day', amount: '333.33' }], null);
    expect(d).toEqual([
      { kind: 'basic', calculated: '1212.00', reported: null, diff: '1212.00' },
      { kind: 'fixed_ot', calculated: '485.00', reported: null, diff: '485.00' },
      { kind: 'leave', calculated: '303.00', reported: null, diff: '303.00' },
      { kind: 'sign_off_day', calculated: '282.83', reported: '333.33', diff: '-50.50' },
    ]);
  });
  it('لا يوم إضافيّ لمن بلغت أيّامه ٣٠', () => {
    const r = computeEntry(base({ signsOffThisMonth: true }), null);
    expect(r.items.some((i) => i.kind === 'sign_off_day')).toBe(false);
    const r2 = computeEntry(base({ payStart: '2026-08-02', signsOffThisMonth: true }), null);
    expect(r2.days).toBe(30);
    expect(r2.items.some((i) => i.kind === 'sign_off_day')).toBe(false);
  });
  it('لا يوم إضافيّ لمن لا ينزل هذا الشهر', () => {
    const r = computeEntry(base({ payStart: '2026-08-06' }), null);
    expect(r.items.some((i) => i.kind === 'sign_off_day')).toBe(false);
  });
  it('يوم النزول المستورَد لا يُعدّ مرّتين — المحسوب وحده في الصافي', () => {
    const r = computeEntry(base({
      payEnd: '2026-08-20', signsOffThisMonth: true,
      extras: [{ key: 'cfm-other', kind: 'sign_off_day', amount: '93.33', currency: 'EUR', review: 'accepted', source: 'cfm' }],
    }), null);
    expect(r.items.filter((i) => i.kind === 'sign_off_day')).toHaveLength(1);
    expect(r.earnings).toBe('1945.87'); // 1131.33 + 452.67 + 282.67 + 79.20
  });
});

describe('يوم الصعود تسويةٌ مستقلّة للمراجعة', () => {
  const signOn = (review: 'pending' | 'accepted' | 'rejected') => computeEntry(base({
    rates: { basic: '6060', fixed_ot: '2425', leave: '1515' }, payStart: '2026-08-06',
    extras: [{ key: 's1', kind: 'sign_on_settlement', amount: '333.33', currency: 'EUR', reason: 'salary of 1 day to sign on', source: 'email', review }],
  }), null);
  it('معلّقةً: خارج الصافي وتمنع الاكتمال', () => {
    const r = signOn('pending');
    expect(r.days).toBe(26);
    expect(r.earnings).toBe('8666.67'); // 5252 + 2101.67 + 1313 — بلا اليوم
    expect(r.complete).toBe(false);
    expect(r.issues.map((i) => i.code)).toContain('item_pending_review');
  });
  it('مقبولةً: سطرٌ مستقلّ لا يُضاف إلى الأيّام', () => {
    const r = signOn('accepted');
    expect(r.days).toBe(26);
    expect(r.earnings).toBe('9000.00');
    expect(r.complete).toBe(true);
    expect(r.items.filter((i) => i.kind === 'sign_on_settlement')).toHaveLength(1);
  });
  it('مرفوضةً: تبقى ظاهرةً ولا تُحسب', () => {
    const r = signOn('rejected');
    expect(r.earnings).toBe('8666.67');
    expect(r.items.find((i) => i.kind === 'sign_on_settlement')!.counted).toBe(false);
  });
});

describe('البنود المستوردة كما هي', () => {
  it('اللاشينج والأمتعة وفرق المرتّب بمصادرها وأسبابها', () => {
    const r = computeEntry(base({
      currency: 'USD', rates: { basic: '2668', fixed_ot: '1066', leave: '666' }, payStart: '2026-08-06',
      extras: [
        { key: 'l', kind: 'lashing', amount: '418.86', currency: 'USD', source: 'email', review: 'accepted' },
        { key: 'g', kind: 'luggage', amount: '89.97', currency: 'USD', reason: 'Extra luggage cost', source: 'email', review: 'accepted' },
        { key: 'a', kind: 'cash_advance', amount: '460', currency: 'USD', source: 'cfm', review: 'accepted' },
      ],
    }), null);
    expect(r.items.slice(0, 3).map((i) => i.amount)).toEqual(['2312.27', '923.87', '577.20']);
    expect(r.earnings).toBe('4322.17');
    expect(r.deductions).toBe('460.00');
    expect(r.balance).toBe('3862.17');
  });
  it('استحقاقٌ تكميليّ بلا مرتّب (صاحب مكافأةٍ خارج كشف الشهر) — لا يُخترع مرتّب', () => {
    const r = computeEntry(base({ rates: null, payStart: null, payEnd: null,
      extras: [{ key: 'b', kind: 'lashing', amount: '47.73', currency: 'EUR', source: 'email', review: 'accepted' }] }), null);
    expect(r.items).toHaveLength(1);
    expect(r.days).toBeNull();
    expect(r.balance).toBe('47.73');
    expect(r.complete).toBe(true);
  });
});

describe('المقارنة بمجموعات المكافآت', () => {
  it('«Bonus» في الرسالة و«lashing Bonus» في CFM بالمبلغ نفسه ⇒ لا فرق', () => {
    const r = computeEntry(base({ extras: [{ key: 'b', kind: 'bonus', amount: '358', currency: 'EUR', review: 'accepted' }] }), null);
    expect(compareWithReported(r, [{ kind: 'basic', amount: '1697' }, { kind: 'fixed_ot', amount: '679' }, { kind: 'leave', amount: '424' }, { kind: 'lashing', amount: '358' }], '3158')).toEqual([]);
  });
});

describe('سعر الصرف', () => {
  const fx: FxMonth = { month: '2026-08', perUsd: { EUR: '0.8547008547' } }; // ≈ 1 EUR = 1.17 USD
  it('السعر من جدول «لكلّ دولار» واتجاهه صريح', () => {
    const r = crossRate(fx, 'EUR', 'USD')!;
    expect(rateLabel('EUR', 'USD', r)).toBe('1 EUR = 1.170000 USD');
    expect(crossRate(fx, 'USD', 'USD')!.toString()).toBe('1');
  });
  it('السلفة باليورو لمرتّبٍ بالدولار تُحوَّل مرّةً واحدة ويُحفظ الأصل والسعر', () => {
    const r = computeEntry(base({ currency: 'USD',
      extras: [{ key: 'adv', kind: 'cash_advance', amount: '100', currency: 'EUR', source: 'attachment', review: 'accepted' }] }), fx);
    const adv = r.items.find((i) => i.key === 'adv')!;
    expect(adv).toMatchObject({ amount: '117.00', currency: 'USD', original_amount: '100.00', original_currency: 'EUR' });
    expect(adv.fx_rate!.startsWith('1.17')).toBe(true);
  });
  it('غياب السعر يوقف البند — لا ١ ولا تخمين', () => {
    for (const f of [null, { month: '2026-08', perUsd: {} }, { month: '2026-08', perUsd: { EUR: '0' } }, { month: '2026-08', perUsd: { EUR: 'abc' } }]) {
      const r = computeEntry(base({ currency: 'USD',
        extras: [{ key: 'adv', kind: 'cash_advance', amount: '100', currency: 'EUR', review: 'accepted' }] }), f as FxMonth | null);
      const adv = r.items.find((i) => i.key === 'adv')!;
      expect(adv.amount).toBeNull();
      expect(adv.counted).toBe(false);
      expect(r.complete).toBe(false);
      expect(r.issues.find((i) => i.code === 'fx_missing')!.blocking).toBe(true);
    }
  });
});

describe('موانع البيانات', () => {
  it('تواريخ ناقصة أو معكوسة أو خارج الشهر أو مرتّبات ناقصة ⇒ غير مكتمل', () => {
    expect(computeEntry(base({ payStart: null }), null).issues[0].code).toBe('dates_missing');
    expect(computeEntry(base({ payStart: '2026-08-20', payEnd: '2026-08-01' }), null).issues[0].code).toBe('dates_inverted');
    expect(computeEntry(base({ payStart: '2026-07-30' }), null).issues[0].code).toBe('dates_outside_month');
    expect(computeEntry(base({ rates: { basic: '', fixed_ot: '1', leave: '1' } }), null).issues[0].code).toBe('rates_missing');
  });
});

describe('الإجماليّات لكلّ عملة على حدة', () => {
  it('لا جمع بين اليورو والدولار', () => {
    const t = totalsByCurrency([
      computeEntry(base(), null),
      computeEntry(base({ currency: 'USD', rates: { basic: '1000', fixed_ot: '400', leave: '250' } }), null),
      computeEntry(base({ payStart: null }), null),
    ]);
    expect(Object.keys(t).sort()).toEqual(['EUR', 'USD']);
    expect(t.EUR).toEqual({ earnings: '2800.00', deductions: '0.00', balance: '2800.00', count: 2, complete: 1 });
    expect(t.USD.balance).toBe('1650.00');
  });
});

describe('إصلاحات المراجعة — ٢٧ سبتمبر', () => {
  it('دقّة السعر: 0.50 EUR عند 1 EUR = 1.17 USD ⇒ 0.59 (نصفٌ لأعلى) لا 0.58', () => {
    expect(convert('0.50', fxAt('1.17'), 'EUR', 'USD')).toBe('0.59');
    expect(convert('1.50', fxAt('1.17'), 'EUR', 'USD')).toBe('1.76');
    expect(convert('0.50', fxAt('1.19'), 'EUR', 'USD')).toBe('0.60');
    expect(rateLabel('EUR', 'USD', crossRate(fxAt('1.17'), 'EUR', 'USD')!)).toBe('1 EUR = 1.170000 USD');
    // والعكس بالسعر نفسه قسمةً — لا بمقلوبٍ مقرَّب
    expect(convert('1.17', fxAt('1.17'), 'USD', 'EUR')).toBe('1.00');
  });
  it('السعر المسترَدّ يساوي المدخَل حرفيّاً لكلّ سعرٍ بستّ منازل', () => {
    for (const r of ['1.17', '1.153459', '0.000123', '48.95', '1.1', '3.75']) {
      expect(crossRate(fxAt(r), 'EUR', 'USD')!.toFixed(6)).toBe(new Decimal(r).toFixed(6));
    }
  });

  it('النزول في آخر يومٍ من الشهر لا يعطي يوماً إضافيّاً — ولو بدأ العمل في منتصفه', () => {
    expect(signOffDayApplies('2026-08', true, '2026-08-31', 22)).toBe(false);
    const r = computeEntry(base({ payStart: '2026-08-10', payEnd: '2026-08-31', signsOffThisMonth: true }), null);
    expect(r.days).toBe(22);
    expect(r.items.some((i) => i.kind === 'sign_off_day')).toBe(false);
  });
  it('والشرط في المحرّك نفسه: تصحيحٌ يدويّ «ينزل هذا الشهر» مع نهايةٍ في آخر الشهر لا يعطيه', () => {
    const r = computeEntry(base({ payStart: '2026-08-06', payEnd: '2026-08-31', signsOffThisMonth: true }), null);
    expect(r.items.some((i) => i.kind === 'sign_off_day')).toBe(false);
    expect(computeEntry(base({ payStart: '2026-08-06', payEnd: '2026-08-30', signsOffThisMonth: true }), null)
      .items.some((i) => i.kind === 'sign_off_day')).toBe(true);
  });
  it('يوم النزول لطاقم الدولار كغيره — القاعدة لا تُقيَّد بعملة', () => {
    const r = computeEntry(base({ currency: 'USD', rates: { basic: '2668', fixed_ot: '1066', leave: '666' }, payEnd: '2026-08-06', signsOffThisMonth: true }), null);
    expect(r.items.find((i) => i.kind === 'sign_off_day')!.amount).toBe('124.47');
  });

  it('عملة دفعٍ استثنائيّة: التحويل مرّةً واحدة، والمقارنة بـ CFM بعملة العقد', () => {
    const r = computeEntry(base({ paymentCurrency: 'USD', extras: [{ key: 'a', kind: 'cash_advance', amount: '200', currency: 'EUR', review: 'accepted' }] }), fxAt('1.17'));
    expect(r.currency).toBe('USD');
    expect(r.contract_currency).toBe('EUR');
    expect(r.items.find((i) => i.kind === 'basic')).toMatchObject({ amount: '1985.49', original_amount: '1697.00', original_currency: 'EUR', contract_amount: '1697.00' });
    expect(r.items.find((i) => i.key === 'a')).toMatchObject({ amount: '234.00', contract_amount: '200.00' });
    // CFM باليورو يطابق المحسوب باليورو — لا فروق وهميّة من اختلاف العملتين
    expect(compareWithReported(r, [{ kind: 'basic', amount: '1697' }, { kind: 'fixed_ot', amount: '679' }, { kind: 'leave', amount: '424' }, { kind: 'cash_advance', amount: '200' }], '2600')).toEqual([]);
    expect(totalsByCurrency([r])).toHaveProperty('USD');
  });
  it('عملة دفعٍ بلا سعر ⇒ كلّ البنود موقوفة، لا تحويل بـ ١', () => {
    const r = computeEntry(base({ paymentCurrency: 'USD' }), null);
    expect(r.items.every((i) => i.amount == null && !i.counted)).toBe(true);
    expect(r.complete).toBe(false);
  });

  it('مبلغٌ غير مقروء مانعٌ ظاهر — ويزول برفضه بسبب', () => {
    const x = (review: 'pending' | 'rejected') => computeEntry(base({ extras: [{ key: 'u', kind: 'lashing', amount: '4I8.76', currency: 'EUR', review }] }), null);
    expect(x('pending').issues.map((i) => i.code)).toContain('amount_unreadable');
    expect(x('pending').complete).toBe(false);
    expect(x('rejected').complete).toBe(true);
  });
  it('عمودٌ ماليّ مجهول لا يُحسب ولا يمرّ — حتّى يُصنَّف أو يُستبعد', () => {
    const r = computeEntry(base({ extras: [{ key: 'z', kind: 'unclassified', amount: '75', currency: 'EUR', reason: 'Special allowance', review: 'accepted' }] }), null);
    expect(r.issues.map((i) => i.code)).toContain('unclassified_item');
    expect(r.items.find((i) => i.key === 'z')!.counted).toBe(false);
    expect(r.balance).toBe('2800.00');
  });
  it('المبلغ نفسه من الرسالة ومن مرفق، وقُبل الاثنان ⇒ مانع', () => {
    const r = computeEntry(base({ extras: [
      { key: 'e', kind: 'bonus', amount: '358', currency: 'EUR', source: 'email', review: 'accepted' },
      { key: 'p', kind: 'bonus', amount: '358', currency: 'EUR', source: 'attachment', review: 'accepted', duplicate_of: 'e', flags: ['possible_duplicate'] },
    ] }), null);
    expect(r.issues.map((i) => i.code)).toContain('duplicate_accepted');
    expect(r.complete).toBe(false);
  });
});
