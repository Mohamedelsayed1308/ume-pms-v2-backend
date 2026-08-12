import { buildIncomeStatement, buildBalanceSheet, AccountBalance } from './financial-statements';

const a = (code: string, name: string, type: string, group: string | null, dr: number, cr: number): AccountBalance =>
  ({ code, name, account_type: type, account_group: group, debit_eur: dr, credit_eur: cr });

// أرصدة يوليو 2026 الفعلية بعد الترحيل.
const JULY: AccountBalance[] = [
  a('4010', 'Charter Revenue', 'revenue', 'REVENUE', 0, 155000),
  a('5040', 'Repairs & Maintenance', 'expense', 'VESSEL_OPEX', 13588.90, 0),
  a('5110', 'Ship Stores', 'expense', 'VESSEL_OPEX', 2391.42, 0),
  a('5120', 'Communications', 'expense', 'VESSEL_OPEX', 229.68, 0),
  a('6030', 'Professional Fees', 'expense', 'ADMIN', 487.20, 0),
  a('6050', 'Software', 'expense', 'ADMIN', 2081.25, 0),
  a('7110', 'Realized FX Gain', 'revenue', 'FINANCE', 0, 56.40),
  a('1600', 'Related Party Receivable', 'asset', 'RELATED_PARTY', 1176898.84, 0),
  a('1200', 'Prepayments', 'asset', 'PREPAYMENTS', 1692.00, 0),
  a('1015', 'Bank — USD', 'asset', 'BANK', 0, 1635.60),
  a('2010', 'Accounts Payable', 'liability', 'PAYABLES', 0, 19228.45),
  a('2300', 'Deferred Revenue', 'liability', 'DEFERRED_INCOME', 0, 70000),
  a('3100', 'Retained Earnings', 'equity', 'EQUITY', 0, 1487556.58),
];

describe('قائمة الدخل', () => {
  it('1. الإيراد يُعرَض بطبيعته الدائنة موجباً', () => {
    const r = buildIncomeStatement(JULY);
    const charter = r.sections[0].lines.find((l) => l.code === '4010')!;
    expect(charter.amount).toBe(155000);
    expect(r.total_revenue).toBe(155056.40);   // ومعه مكسب الصرف 56.40
  });

  it('2. مصروفات التشغيل تُفصَل عن الإدارية', () => {
    const r = buildIncomeStatement(JULY);
    const opex = r.sections.find((s) => s.key === 'vessel_opex')!;
    const admin = r.sections.find((s) => s.key === 'admin')!;
    expect(opex.total).toBe(16210.00);   // 13588.90 + 2391.42 + 229.68
    expect(admin.total).toBe(2568.45);   // 487.20 + 2081.25
  });

  it('3. مكسب الصرف إيراد في دليل الحسابات الفعلي لا مصروف سالب', () => {
    const r = buildIncomeStatement(JULY);
    expect(r.total_revenue).toBe(155056.40);          // 155,000 إيجار + 56.40 صرف
    expect(r.sections.find((s) => s.key === 'finance')!.lines).toHaveLength(0);
  });

  // 136,277.95 هي النتيجة الصافية. والتشغيلية بلا مكسب الصرف 136,221.55 — الفرق
  // 56.40 مكسب محقَّق، أُغفل في تقرير سابق فيُثبَّت هنا باختبار.
  // ملاحظة: 7110 مصنَّف إيراداً في دليل الحسابات الفعلي، فالنتيجة واحدة أيّاً كان.
  it('4. نتيجة يوليو الصافية تطابق المحسوب', () => {
    const r = buildIncomeStatement(JULY);
    expect(r.total_expense).toBe(18778.45);
    expect(r.net_result).toBe(136277.95);
  });

  it('5. حساب بلا مجموعة معروفة يظهر في «غير مصنَّف» ولا يُبتلع', () => {
    const rows = [...JULY, a('5999', 'Mystery', 'expense', 'NOWHERE', 100, 0)];
    const r = buildIncomeStatement(rows);
    const other = r.sections.find((s) => s.key === 'other')!;
    expect(other.lines).toHaveLength(1);
    expect(other.total).toBe(100);
    // ويدخل الإجمالي — الظهور ليس عزلاً
    expect(r.total_expense).toBe(18878.45);
  });

  it('6. لا يظهر بند «غير مصنَّف» إن لم يوجد', () => {
    expect(buildIncomeStatement(JULY).sections.some((s) => s.key === 'other')).toBe(false);
  });

  it('7. الحسابات بلا حركة لا تُعرَض', () => {
    const r = buildIncomeStatement([...JULY, a('5888', 'Idle', 'expense', 'VESSEL_OPEX', 0, 0)]);
    expect(r.sections.find((s) => s.key === 'vessel_opex')!.lines.some((l) => l.code === '5888')).toBe(false);
  });
});

describe('المركز المالي', () => {
  it('8. الأصول والالتزامات بإشاراتها الطبيعية', () => {
    const inc = buildIncomeStatement(JULY);
    const bs = buildBalanceSheet(JULY, inc.net_result);
    expect(bs.assets.total).toBe(1176955.24);      // 1176898.84 + 1692.00 − 1635.60
    expect(bs.liabilities.total).toBe(89228.45);   // 19228.45 + 70000
    expect(bs.equity.total).toBe(1487556.58);
  });

  it('9. نتيجة الفترة تُعرَض منفصلة ولا تُدمج تلقائياً', () => {
    const inc = buildIncomeStatement(JULY);
    const bs = buildBalanceSheet(JULY, inc.net_result);
    expect(bs.net_result_unclosed).toBe(136277.95);
    expect(bs.total_equity_with_result).toBe(1623834.53);
    expect(bs.equity.total).not.toBe(bs.total_equity_with_result);
  });

  it('10. الفرق يُعرَض صريحاً ولا يُخفى بموازنة صورية', () => {
    const inc = buildIncomeStatement(JULY);
    const bs = buildBalanceSheet(JULY, inc.net_result);
    expect(bs.difference).toBe(
      Math.round((bs.assets.total - bs.total_liabilities_and_equity) * 100) / 100);
    // الأرصدة أعلاه جزئية عمداً — فوجود فرق متوقَّع ومعروض لا مكتوم
    expect(typeof bs.is_balanced).toBe('boolean');
  });

  it('11. مجموعة متوازنة فعلاً تُعطي is_balanced', () => {
    const rows: AccountBalance[] = [
      a('1010', 'Bank', 'asset', 'BANK', 1000, 0),
      a('2010', 'AP', 'liability', 'PAYABLES', 0, 400),
      a('3010', 'Capital', 'equity', 'EQUITY', 0, 500),
      a('4010', 'Revenue', 'revenue', 'REVENUE', 0, 200),
      a('5010', 'Expense', 'expense', 'VESSEL_OPEX', 100, 0),
    ];
    const inc = buildIncomeStatement(rows);
    const bs = buildBalanceSheet(rows, inc.net_result);
    expect(inc.net_result).toBe(100);
    expect(bs.difference).toBe(0);
    expect(bs.is_balanced).toBe(true);
  });
});
