import { lineVoyagesFromData, toLineVoyage, LINE_VESSELS } from './vessel-profit-sheet';

/*
 * خطّ جدّة/سواكن — القارئ يُسلّم البنود كما هي، ويقول إن لم تُساوِ إجماليّاتها.
 */
const voyage = (over: any = {}) => ({
  ref: 1, vessel: 'DALEELA', line: 'جدّة/سواكن', year: 2026,
  dateExp: '2026-01-03', dateImp: '2026-01-04',
  nTruck_E: 65, nTruck_I: 20, nVeh_E: 75, nVeh_I: 3, nPax_E: 462, nPax_I: 300,
  trE: 93120, vhE: 20873.33, pxE: 59786.67, trI: 10000, vhI: 500, pxI: 40000,
  furn_E: 3333.33, dord_I: 5000,
  cTR: 9725.47, cPA: 11957.33,
  bnk: 40000, portA: 25990.14, exFurn: 2386.67,
  income: 232613.33, comm: 21682.8, man: 68376.81, net: 142553.72,
  ...over,
});
const row = (p: any) => [null, null, null, null, null, null, null, null, null, null, JSON.stringify(p)];

describe('خطّ جدّة/سواكن — قراءة الرحلات', () => {
  it('البنود تصل بأسمائها ورِجليها، والفرق صفر في الرحلة السليمة', () => {
    const v = toLineVoyage(voyage());
    expect(v.E.trucks).toBe(65);
    expect(v.I.pax).toBe(300);
    expect(v.E.rev.tr).toBe(93120);
    expect(v.E.rev.furn).toBe(3333.33);
    expect(v.I.rev.dord).toBe(5000);
    expect(v.comm.cPA).toBe(11957.33);
    expect(v.exp.portA).toBe(25990.14);
    expect(v.gap).toBe(0);
    expect(v.month).toBe('2026-01');
  });

  it('بندٌ ناقص يظهر فرقاً لا يختفي', () => {
    // إجماليّ المصاريف أعلى من بنوده — كما كان قبل إصلاح السحب
    const v = toLineVoyage(voyage({ man: 78376.81, net: 132553.72 }));
    expect(v.gap).toBeCloseTo(10000, 2);
  });

  it('الخطّ شرط: رحلات دليلة على ضبا/سفاجا لا تدخل كارت جدّة/سواكن', () => {
    const rows = [
      row(voyage({ ref: 1 })),
      row(voyage({ ref: 2, line: 'ضبا/سفاجا', dateExp: '2025-05-01' })),
      row(voyage({ ref: 3, vessel: 'AMMAN' })),
    ];
    const out = lineVoyagesFromData(rows, 'DaleelaJS');
    expect(out.map((v) => v.ref)).toEqual([1]);
    expect(lineVoyagesFromData(rows, 'AmmanJS').map((v) => v.ref)).toEqual([3]);
  });

  it('خانات القالب الفارغة لا تُعدّ رحلات', () => {
    const empty = { ref: 99, vessel: 'DALEELA', line: 'جدّة/سواكن', dateExp: '', dateImp: '', income: 0, comm: 0, man: 0, net: 0 };
    const datedEmpty = { ...empty, ref: 98, dateExp: '2026-09-01' };
    expect(lineVoyagesFromData([row(empty), row(datedEmpty)], 'DaleelaJS')).toEqual([]);
  });

  it('إيجار عمّان في دفترها يُقرأ بنداً مستقلّاً', () => {
    const v = toLineVoyage(voyage({ vessel: 'AMMAN', hire: 36000, man: 104376.81, net: 106553.72 }));
    expect(v.exp.hire).toBe(36000);
    expect(v.gap).toBe(0);
  });

  it('مونتي مهيّأةٌ مسبقاً', () => {
    expect(LINE_VESSELS.MonteJS).toEqual({ vessel: 'MONTE', line: 'جدّة/سواكن' });
    expect(lineVoyagesFromData([row(voyage())], 'MonteJS')).toEqual([]);
  });
});
