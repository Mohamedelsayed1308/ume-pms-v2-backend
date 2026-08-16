import {
  buildSplitMap, transactionType, buildPartyBalanceDetail, buildPartyBalanceSummary, buildGeneralLedger,
  type LedgerLine, type SplitSource,
} from './subledger-reports';

const line = (o: Partial<LedgerLine>): LedgerLine => ({
  entry_id: 'e1', entry_no: 'PJ-1', entry_date: '2026-07-10', entry_status: 'posted',
  event_type: 'invoice_accrual', reference: null, description: null,
  account_id: 'a-ap', account_code: '2010', account_name: 'Accounts Payable — Trade',
  account_type: 'liability', parent_id: null,
  debit_eur: 0, credit_eur: 0, party_id: 's1', party_name: 'SERMACO',
  ...o,
});

describe('transactionType', () => {
  /*
   * الأنواع هنا هي الثابتة في `ACCOUNTING_EVENT_TYPES` لا أسماء مخترَعة.
   * أوّل نسخة اخترعتُ فيها الأسماء أسقطت المطابقة كلّها إلى `General Journal`
   * على الإنتاج — ولم يكشفها اختبار لأنه كان يختبر الاختراع نفسه.
   */
  it('الاستحقاق يفرّقه الطرف: فاتورة مورّد Bill وفاتورة عميل Invoice', () => {
    expect(transactionType('invoice_accrual', 'vendor')).toBe('Bill');
    expect(transactionType('invoice_accrual', 'customer')).toBe('Invoice');
  });

  it('والسداد كذلك', () => {
    expect(transactionType('payment_settlement', 'vendor')).toBe('Bill Pmt');
    expect(transactionType('payment_settlement', 'customer')).toBe('Payment');
  });

  it('بلا طرفٍ معروف لا يُنسب إلى أحدهما', () => {
    expect(transactionType('invoice_accrual', null)).toBe('Accrual');
    expect(transactionType('payment_settlement', null)).toBe('Settlement');
  });

  it('ما لا مقابل له يبقى General Journal', () => {
    for (const e of ['manual', 'opening_balance', 'reversal', 'adjustment', 'depreciation', 'fx_revaluation']) {
      expect(transactionType(e, 'vendor')).toBe('General Journal');
    }
    expect(transactionType(null)).toBe('General Journal');
  });
});

describe('buildSplitMap', () => {
  const s = (entry: string, id: string, code: string): SplitSource =>
    ({ entry_id: entry, account_id: id, account_code: code, account_name: 'X' });

  it('قيدٌ من سطرين: كلٌّ يرى مقابله بالاسم', () => {
    const m = buildSplitMap([s('e1', 'a', '5001'), s('e1', 'b', '2010')]);
    expect(m.get('e1|a')).toBe('2010 · X');
    expect(m.get('e1|b')).toBe('5001 · X');
  });

  it('قيدٌ من ثلاثة: -SPLIT- لا اسمُ أحدها', () => {
    const m = buildSplitMap([s('e1', 'a', '5001'), s('e1', 'b', '2010'), s('e1', 'c', '2200')]);
    expect(m.get('e1|a')).toBe('-SPLIT-');
  });

  it('سطران على الحساب نفسه ليسا مقابلين — يبقى المقابل واحداً', () => {
    const m = buildSplitMap([s('e1', 'a', '5001'), s('e1', 'a', '5001'), s('e1', 'b', '2010')]);
    expect(m.get('e1|a')).toBe('2010 · X');
  });
});

describe('buildPartyBalanceDetail — الدائنون', () => {
  const opts = { as_of: '2026-08-15', normal: 'credit' as const, account_codes: ['2010'] };

  it('الفاتورة تزيد الدَّين والسداد ينقصه', () => {
    const r = buildPartyBalanceDetail([
      line({ entry_id: 'e1', entry_no: 'PJ-1', entry_date: '2026-07-10', credit_eur: 1000 }),
      line({ entry_id: 'e2', entry_no: 'BJ-1', entry_date: '2026-07-20', debit_eur: 400, event_type: 'payment_settlement' }),
    ], opts);

    const g = r.groups[0];
    expect(g.rows.map((x) => x.amount)).toEqual([1000, -400]);
    expect(g.rows.map((x) => x.balance)).toEqual([1000, 600]);
    expect(g.balance).toBe(600);
  });

  it('الرصيد الجاري يُصفَّر عند كل مورّد', () => {
    const r = buildPartyBalanceDetail([
      line({ party_id: 's1', party_name: 'AAA', credit_eur: 100 }),
      line({ party_id: 's2', party_name: 'BBB', credit_eur: 250 }),
    ], opts);
    expect(r.groups.map((g) => g.balance)).toEqual([100, 250]);
  });

  it('سطرٌ بلا طرف يُعزل ولا يُدسّ في مجموع منسوب', () => {
    const r = buildPartyBalanceDetail([
      line({ party_id: 's1', party_name: 'AAA', credit_eur: 100 }),
      line({ party_id: null, party_name: null, credit_eur: 450, event_type: 'opening_balance' }),
    ], opts);

    expect(r.attributed_total).toBe(100);
    expect(r.unattributed_total).toBe(450);
    expect(r.grand_total).toBe(550);
    // غير المنسوب في الذيل لا وسط الأسماء
    expect(r.groups[r.groups.length - 1].unattributed).toBe(true);
  });

  it('الترتيب زمنيّ فيُعاد إنتاج الرصيد نفسه مهما اختلف ترتيب الدخل', () => {
    const a = line({ entry_no: 'B', entry_date: '2026-07-20', debit_eur: 400 });
    const b = line({ entry_no: 'A', entry_date: '2026-07-10', credit_eur: 1000 });
    const r1 = buildPartyBalanceDetail([a, b], opts);
    const r2 = buildPartyBalanceDetail([b, a], opts);
    expect(r1.groups[0].rows.map((x) => x.balance)).toEqual(r2.groups[0].rows.map((x) => x.balance));
  });
});

describe('buildPartyBalanceDetail — المدينون', () => {
  it('المدين طبيعته مدينة: الفاتورة مدينة تزيد والتحصيل ينقص', () => {
    const r = buildPartyBalanceDetail([
      line({ account_code: '1100', debit_eur: 5000, event_type: 'invoice_accrual', party_name: 'UME AB' }),
      line({ entry_id: 'e2', account_code: '1100', credit_eur: 2000, event_type: 'payment_settlement', party_name: 'UME AB' }),
    ], { as_of: '2026-08-15', normal: 'debit', account_codes: ['1100'] });

    expect(r.groups[0].rows.map((x) => x.amount)).toEqual([5000, -2000]);
    expect(r.groups[0].balance).toBe(3000);
  });
});

describe('buildPartyBalanceSummary', () => {
  const opts = { as_of: '2026-08-15', normal: 'credit' as const, account_codes: ['2010'] };

  it('يُسقط من سُوّي حسابه ويُبقي المجموع', () => {
    const d = buildPartyBalanceDetail([
      line({ party_id: 's1', party_name: 'AAA', credit_eur: 100 }),
      line({ entry_id: 'e2', party_id: 's2', party_name: 'BBB', credit_eur: 300 }),
      line({ entry_id: 'e3', party_id: 's2', party_name: 'BBB', debit_eur: 300, event_type: 'payment_settlement' }),
    ], opts);
    const s = buildPartyBalanceSummary(d);

    expect(s.rows.map((r) => r.party_name)).toEqual(['AAA']);
    expect(s.total).toBe(100);
  });

  it('مشتقٌّ من التفصيل فمجموعهما واحد دائماً', () => {
    const d = buildPartyBalanceDetail([
      line({ party_id: 's1', party_name: 'AAA', credit_eur: 1234.56 }),
      line({ entry_id: 'e2', party_id: null, party_name: null, credit_eur: 450 }),
    ], opts);
    expect(buildPartyBalanceSummary(d).total).toBe(d.grand_total);
  });
});

describe('buildGeneralLedger', () => {
  const splits = new Map<string, string>();

  it('الافتتاحي ثم الحركة ثم الختامي', () => {
    const r = buildGeneralLedger([
      line({ account_id: 'a1', account_code: '1010', account_name: 'Bank', debit_eur: 500 }),
      line({ entry_id: 'e2', account_id: 'a1', account_code: '1010', account_name: 'Bank', credit_eur: 200 }),
    ], { from: '2026-07-01', to: '2026-07-31', openings: new Map([['a1', 1000]]), splits });

    const acc = r.accounts[0];
    expect(acc.opening).toBe(1000);
    expect(acc.rows.map((x) => x.balance)).toEqual([1500, 1300]);
    expect(acc.closing).toBe(1300);
  });

  it('الإشارة مدينة دائماً فيبقى عمود المبالغ قابلاً للجمع', () => {
    const r = buildGeneralLedger([
      line({ account_id: 'a1', account_code: '1010', debit_eur: 500 }),
      line({ entry_id: 'e2', account_id: 'a2', account_code: '4000', credit_eur: 500 }),
    ], { from: null, to: '2026-07-31', openings: new Map(), splits });

    expect(r.total_period_amount).toBe(0);
  });

  it('حسابٌ ساكن له رصيد لا يختفي من الدفتر', () => {
    const r = buildGeneralLedger([
      line({ account_id: 'a1', account_code: '1010', debit_eur: 500 }),
    ], { from: null, to: '2026-07-31', openings: new Map([['a1', 0], ['a-idle', 767982.79]]), splits });

    const idle = r.accounts.find((a) => a.account_id === 'a-idle');
    expect(idle).toBeDefined();
    expect(idle!.closing).toBe(767982.79);
    expect(idle!.rows).toHaveLength(0);
  });

  it('حسابٌ ساكن برصيد صفر لا يُحشى به التقرير', () => {
    const r = buildGeneralLedger([], { from: null, to: '2026-07-31', openings: new Map([['z', 0]]), splits });
    expect(r.accounts).toHaveLength(0);
  });

  it('يحمل الحساب المقابل حين يكون القيد من سطرين', () => {
    const sp = buildSplitMap([
      { entry_id: 'e1', account_id: 'a1', account_code: '1010', account_name: 'Bank' },
      { entry_id: 'e1', account_id: 'a2', account_code: '4000', account_name: 'Revenue' },
    ]);
    const r = buildGeneralLedger([
      line({ account_id: 'a1', account_code: '1010', debit_eur: 500 }),
    ], { from: null, to: '2026-07-31', openings: new Map(), splits: sp });

    expect(r.accounts[0].rows[0].split).toBe('4000 · Revenue');
  });
});
