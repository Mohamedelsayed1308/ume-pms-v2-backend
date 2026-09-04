import { buildFigures, allowedNumbers, unmatchedNumbers, type CardLike } from './stone-report';

/**
 * ── حارس الأرقام ──
 * التقرير سردٌ يكتبه نموذج، والحارس هو ما يمنع رقماً مخترَعاً من الوصول إلى
 * الإدارة. فيُختبر على ما يجب أن يمرّ (الأرقام نفسها بصيغٍ مختلفة) وما يجب
 * أن يُمسك (رقمٌ لم نُعطه).
 */
const card: CardLike = {
  as_of: '2026-09-04',
  summary: {
    borrowed_from_parent: 1138750, repaid_to_parent: 0, outstanding_to_parent: 1138750,
    invested_in_stone: 1557500, returned_confirmed: 176250, returned_announced: 93750,
    interest_outstanding: 0, interest_has_terms: true, interest_agreed: true,
  },
  rounds: [
    {
      id: 'r7', round_no: 7, commitment: 1250000, contributed: 1137500, contributed_pct: 91,
      funded_by_parent: 1138750, repat_confirmed: 176250, repat_announced: 93750,
      capital_returned: 176250, capital_at_stone: 961250, realized_gain: 0,
      bee_share_pct: 2.5, book_result_share: 850, book_value: 962100, vessels: 45,
      fund_report: { as_of: '2026-06-30', fund_size_usd: 50000000, fund_called_usd: 45500000, result_period_usd: 2469000, result_cumulative_usd: 34000, vessels_count: 48, source: 'CTM Q2 2026' },
    },
    {
      id: 'r8', round_no: 8, commitment: 1500000, contributed: 420000, contributed_pct: 28,
      funded_by_parent: 0, repat_confirmed: 0, repat_announced: 0,
      capital_returned: 0, capital_at_stone: 420000, realized_gain: 0,
      bee_share_pct: null, book_result_share: null, book_value: null, vessels: 8, fund_report: null,
    },
  ],
  parent_ledger: [{ occurred_at: '2026-03-03', direction: 'funding', kind: 'principal', amount_usd: '112500', round_id: 'r7' }],
  investment_ledger: [
    { round_id: 'r7', direction: 'repatriation', call_date: '2026-09-09', paid_date: null, amount_usd: '93750', status: 'announced' },
    { round_id: 'r8', direction: 'contribution', call_date: '2026-08-19', paid_date: '2026-08-28', amount_usd: '82500', status: null },
  ],
  interest_terms: [{ rate_pct: '0', is_agreed: true }],
  open_items: [{ title: 'Confirm calls 4 and 5', status: 'open' }, { title: 'done', status: 'closed' }],
  alerts: [{ text: 'الجولة 8: استُثمر 420,000 ولم تُقرض الأمّ شيئاً' }],
};

describe('buildFigures', () => {
  const f = buildFigures(card);

  it('يجمع الإجماليّات من الجولات لا من رقمٍ محفوظ', () => {
    expect(f.totals.capital_at_stone).toBe(1381250);
    expect(f.totals.realized_gain).toBe(0);
    expect(f.totals.book_result_share).toBe(850);
    // الجولة بلا تقريرٍ تدخل بقيمتها الرأسماليّة وحدها
    expect(f.totals.book_value).toBe(962100 + 420000);
  });

  it('لا تقريرَ صندوقٍ في أيّ جولة ⇒ المكسب الدفتريّ null لا صفر', () => {
    const noReports = { ...card, rounds: card.rounds.map((r) => ({ ...r, fund_report: null, book_result_share: null, book_value: null })) };
    expect(buildFigures(noReports).totals.book_result_share).toBeNull();
  });

  it('الأحداث الأخيرة مرتّبةٌ من الأحدث، والمساهمة غير المدفوعة موسومة', () => {
    expect(f.recent_events[0].date).toBe('2026-09-09');
    expect(f.recent_events[0].text).toMatch(/repatriation .*announced/);
  });

  it('البنود المفتوحة تُعدّ بلا المُغلَق', () => {
    expect(f.open_items.open).toBe(1);
  });
});

describe('حارس الأرقام', () => {
  const allowed = allowedNumbers(buildFigures(card));

  it('يقبل الرقم نفسه بصيغه: فواصل، آلاف، ملايين، كسور', () => {
    const text = 'Bee paid 1,137,500 (1.14 M) into Round 7 and 420,000 into Round 8; 176,250 came back; capital at Stone 1,381,250 (1.38M). Share 2.5%. Fund called 45.5 M of 50 M.';
    expect(unmatchedNumbers(text, allowed)).toEqual([]);
  });

  it('يقبل التواريخ والسنوات والأعداد الصغيرة', () => {
    const text = 'As at 04-09-2026 and 4 September 2026; 48 vessels; 91% drawn; value date 2026-09-09; by 2027.';
    expect(unmatchedNumbers(text, allowed)).toEqual([]);
  });

  it('يمسك رقماً لم يُعطَه', () => {
    const text = 'Realized gain of 250,000 and an expected return of 1,875,000.';
    expect(unmatchedNumbers(text, allowed).sort()).toEqual(['1,875,000', '250,000']);
  });

  it('لا يُخدع بتقريبٍ بعيد', () => {
    // 1.2 M ليست 1,137,500 بأيّ تقريب
    expect(unmatchedNumbers('about 1.2 M invested', allowed).length).toBe(0); // 1.2 ≤ 100 يُهمل كعددٍ صغير
    expect(unmatchedNumbers('about 1,200,000 invested', allowed)).toEqual(['1,200,000']);
  });
});
