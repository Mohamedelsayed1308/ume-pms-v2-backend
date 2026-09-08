import { accountCode, classify, dedupeKey, parseDepreciation, rowError, type CogsRow } from './vessel-cogs-classify';

const row = (over: Partial<CogsRow> = {}): CogsRow => ({
  account_path: '51 · Supplies & Maintenance / 533 · Supplies',
  doc_type: 'Bill', entry_date: '2026-01-31', doc_number: 'PE-26-01-01', supplier: 'Badawi Shipping',
  memo: 'Supplies M/V Poseidon Express Jan 2026', amount_book: 27039.29, amount_usd: 31095.18, depreciation_text: null,
  ...over,
});

describe('accountCode', () => {
  it('يأخذ آخر رقمٍ في المسار — والفرعيّ يغلب الأصل', () => {
    expect(accountCode('51 · Supplies & Maintenance / 533 · Supplies')).toBe('533');
    expect(accountCode('51 · Supplies & Maintenance / 550 · UME DMCC / 5501 · Management')).toBe('5501');
    expect(accountCode('5002 · Depreciation Exp Dry Dock 2025')).toBe('5002');
    expect(accountCode('')).toBe('');
  });
});

describe('parseDepreciation', () => {
  it('يقرأ السنين شهوراً والشهور كما هي', () => {
    expect(parseDepreciation('1 Year')).toBe(12);
    expect(parseDepreciation('3 Year')).toBe(36);
    expect(parseDepreciation('5 Year')).toBe(60);
    expect(parseDepreciation('10 M')).toBe(10);
    expect(parseDepreciation('2 M')).toBe(2);
    expect(parseDepreciation('1 Year/ ask')).toBe(12);
    expect(parseDepreciation('')).toBeNull();
    expect(parseDepreciation('ask')).toBeNull();
  });
});

describe('classify — قرارات المالك ٨ سبتمبر ٢٠٢٦', () => {
  it('التموينات مشترياتٌ تُحمَّل في شهرها', () => {
    const c = classify(row());
    expect(c).toMatchObject({ account_code: '533', category: 'supplies', charged: true, depreciation_months: null, unmapped: false });
  });
  it('الإهلاك من عمود المحاسب', () => {
    expect(classify(row({ account_path: '51 · S&M / 521 · Turbo Systems', depreciation_text: '3 Year' })).depreciation_months).toBe(36);
  });
  it('التأمين يُستبعد: الوثيقة هي المرجع', () => {
    for (const code of ['5201', '5202', '5203']) {
      const c = classify(row({ account_path: `52 · Vessel Insurance / ${code} · X`, depreciation_text: '10 M' }));
      expect(c.charged).toBe(false);
      expect(c.category).toBe('insurance');
      expect(c.depreciation_months).toBeNull();
      expect(c.exclude_reason).toContain('الوثيقة');
    }
  });
  it('المياه العذبة في دفتر الرحلات فلا تُحمَّل', () => {
    const c = classify(row({ account_path: '55 · Provision & Fresh Water / 53203 · Fresh Water' }));
    expect(c.charged).toBe(false);
  });
  it('إهلاك الدراي دوك الشهريّ يُستبعد لصالح السطر السنويّ', () => {
    expect(classify(row({ account_path: '5002 · Depreciation Exp Dry Dock 2025' })).charged).toBe(false);
  });
  it('الزيوت بندٌ مستقلّ ولا يحمل كلمة Bunker', () => {
    const c = classify(row({ account_path: '57 · Bunker & Lubricant / 53402 · Bunker' }));
    expect(c.category).toBe('lubricants');
    expect(c.item_label.toLowerCase()).not.toContain('bunker');
  });
  it('المرتّبات فئتها الخاصّة', () => {
    expect(classify(row({ account_path: '53 · Crew Cost / 5312 · Salary' })).category).toBe('salary');
  });
  it('مصاريف التوكيلين تُستبعد — فهي في دفتر الرحلات (تصحيح المالك)', () => {
    for (const code of ['5301', '5305', '5306', '5307', '5292']) {
      const c = classify(row({ account_path: `54 · Port Fees / 530 · X / ${code} · Y` }));
      expect(c.charged).toBe(false);
      expect(c.exclude_reason).toContain('دفتر الرحلات');
    }
  });
  it('حسابٌ مجهول يُعلَم ولا يُخفى', () => {
    const c = classify(row({ account_path: '59 · New / 599 · Unknown' }));
    expect(c.unmapped).toBe(true);
    expect(c.charged).toBe(true);
  });
});

describe('dedupeKey', () => {
  it('ثابتٌ على المسافات وحالة الأحرف، ولا يتأثّر بالمذكّرة', () => {
    const a = dedupeKey('Poseidon Express', row(), '533');
    const b = dedupeKey('Poseidon Express', row({ memo: 'edited later', supplier: '  badawi   shipping ' }), '533');
    expect(a).toBe(b);
  });
  it('يتغيّر بالمبلغ أو التاريخ أو رقم المستند', () => {
    const a = dedupeKey('Poseidon Express', row(), '533');
    expect(dedupeKey('Poseidon Express', row({ amount_book: 1 }), '533')).not.toBe(a);
    expect(dedupeKey('Poseidon Express', row({ entry_date: '2026-02-01' }), '533')).not.toBe(a);
    expect(dedupeKey('Poseidon Express', row({ doc_number: 'X' }), '533')).not.toBe(a);
  });
});

describe('rowError', () => {
  it('يرفض التاريخ والمبلغ غير الصالحين', () => {
    expect(rowError(row())).toBeNull();
    expect(rowError(row({ entry_date: '31/01/2026' }))).toBeTruthy();
    expect(rowError(row({ amount_usd: NaN }))).toBeTruthy();
    expect(rowError(row({ account_path: '' }))).toBeTruthy();
  });
});
