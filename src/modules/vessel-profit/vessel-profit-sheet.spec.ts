import { voyagesFromData, toSheetVoyage, SHEET_VESSELS } from './vessel-profit-sheet';

/*
 * الحمولة أدناه منسوخة من رحلةٍ حقيقية في `DATA` بعد السحب من دفتر ألكوديا.
 *
 * الاختبار يحرس **شكل** المخرجات لا حسبةً: الشاشة تنتظر رِجلين بأعدادهما
 * ومصاريفهما مفصولة، وأي تغيير في أسماء الحقول يكسرها بصمت — تعرض أصفاراً
 * تبدو كشهرٍ بلا نشاط.
 */
const ALCUDIA_ROW = {
  vessel: 'ALCUDIA', ref: 1, year: 2026,
  dateExp: '2026-01-02', dateImp: '2026-01-03',
  nTruck: 268, nTruck_E: 0, nTruck_I: 268,
  nVeh: 27, nVeh_E: 0, nVeh_I: 27,
  nPax: 17, nPax_E: 0, nPax_I: 17,
  trE: 0, vhE: 317.93, pxE: 837.86, dis: 18398.31, dis_E: 18398.31, dis_I: 0,
  trI: 98956, vhI: 4306.67, pxI: 560,
  pkNo_E: 0, pkNo_I: 6199.36,
  collO: 15107.08, collP: 18398.31,
  aa: 1416.44, aa_E: 1416.44, aa_I: 0,
  ab: 10189.12, ab_E: 10189.12, ab_I: 0,
  pg: 12753.15, pg_E: 12753.15, pg_I: 0,
  fw: 453.33, fw_E: 0, fw_I: 453.33,
  r: 9725.6, r_E: 0, r_I: 9725.6,
  oth: -4095.73, oth_E: 0, oth_I: -4095.73,
  bnk: 43136.29, net: 40789.87, liq: 199417.44,
};

describe('قراءة رحلات المركب من الشيت الموحّد', () => {
  const spec = SHEET_VESSELS.Alcudia;

  it('تفصل الرِّجلين بأعدادهما ومبالغهما', () => {
    const v = toSheetVoyage(ALCUDIA_ROW, spec);
    expect(v.month).toBe('2026-01');
    expect(v.I.truckC).toBe(268);
    expect(v.E.truckC).toBe(0);
    expect(v.I.truck).toBe(98956);
    expect(v.E.veh).toBe(317.93);
    expect(v.E.discharge).toBe(18398.31);
    expect(v.I.discharge).toBe(0);
    expect(v.I.houryaC).toBe(6199.36);
  });

  it('توزّع كل مصروفٍ على رِجله بمفتاح الشاشة', () => {
    const v = toSheetVoyage(ALCUDIA_ROW, spec);
    expect(v.E.exp.dischargeOrderTax).toBe(1416.44);
    expect(v.E.exp.disShiOrder60).toBe(10189.12);
    expect(v.E.exp.egyPort).toBe(12753.15);
    expect(v.I.exp.fw).toBe(453.33);
    expect(v.I.exp.comm10).toBe(9725.6);
    expect(v.I.exp.othersI).toBe(-4095.73);
    // بندٌ لا يقع على هذه الرِّجل يُقرأ صفراً لا undefined — الشاشة تجمعه
    expect(v.E.exp.fw).toBeUndefined();
    expect(v.I.exp.egyPort).toBeUndefined();
    expect(v.E.exp.broker).toBe(0);
  });

  it('تنقل السيولة من الشيت لا تُصفّرها', () => {
    /*
     * كان هذا الحقل يُكتب صفراً صراحةً حين لم يكن الشيت يحمله — فكانت شاشة
     * حساب البسّام تعرض أصفاراً وتقول «السيولة مش ظاهرة». وصار الشيت يحمله،
     * فيُحرَس هنا: صفرٌ في المخرجات مع قيمةٍ في المدخلات عطبٌ لا إغفال.
     */
    const v = toSheetVoyage(ALCUDIA_ROW, spec);
    expect(v.bassamLiq).toBe(199417.44);
    expect(toSheetVoyage({ ...ALCUDIA_ROW, liq: undefined }, spec).bassamLiq).toBe(0);
  });

  it('تتجاهل سيولة ما قبل 2026 — تعريفٌ قديم لا يُخلط بالجديد', () => {
    expect(toSheetVoyage({ ...ALCUDIA_ROW, year: 2025 }, spec).bassamLiq).toBe(0);
    expect(toSheetVoyage({ ...ALCUDIA_ROW, year: 2024 }, spec).bassamLiq).toBe(0);
    expect(toSheetVoyage({ ...ALCUDIA_ROW, year: 2027 }, spec).bassamLiq).toBe(199417.44);
    // بلا حقل سنة: تُشتقّ من التاريخ
    expect(toSheetVoyage({ ...ALCUDIA_ROW, year: undefined, dateExp: '2025-06-01' }, spec).bassamLiq).toBe(0);
    // وبقيّة الحقول لا تتأثّر بالسنة
    expect(toSheetVoyage({ ...ALCUDIA_ROW, year: 2025 }, spec).net).toBe(40789.87);
  });

  it('تنقل التحصيل والبانكر والصافي كما هي', () => {
    const v = toSheetVoyage(ALCUDIA_ROW, spec);
    expect(v.O).toBe(15107.08);
    expect(v.P).toBe(18398.31);
    expect(v.bunker).toBe(43136.29);
    expect(v.net).toBe(40789.87);
  });

  it('تُرجع رحلات المركب المطلوب وحده', () => {
    const rows: any[][] = [
      [], // صف العناوين
      [null, null, null, null, null, null, null, null, null, null, JSON.stringify(ALCUDIA_ROW)],
      [null, null, null, null, null, null, null, null, null, null,
        JSON.stringify({ ...ALCUDIA_ROW, vessel: 'PELAGOS', ref: 9 })],
      [null, null, null, null, null, null, null, null, null, null, 'ليس JSON'],
      [null, null, null, null, null, null, null, null, null, null, null],
    ];
    const out = voyagesFromData(rows, 'Alcudia');
    expect(out).toHaveLength(1);
    expect(out[0].ref).toBe(1);
  });

  it('تسقط إلى تاريخ الوصول حين يغيب تاريخ المغادرة', () => {
    const v = toSheetVoyage({ ...ALCUDIA_ROW, dateExp: '' }, spec);
    expect(v.month).toBeNull();
    expect(v.monthAlt).toBe('2026-01');
    const rows: any[][] = [[], [null, null, null, null, null, null, null, null, null, null,
      JSON.stringify({ ...ALCUDIA_ROW, dateExp: '' })]];
    expect(voyagesFromData(rows, 'Alcudia')[0].month).toBe('2026-01');
  });

  it('تتجاهل رحلةً بلا تاريخٍ إطلاقاً — الشاشة تعرض بالشهر', () => {
    const rows: any[][] = [[], [null, null, null, null, null, null, null, null, null, null,
      JSON.stringify({ ...ALCUDIA_ROW, dateExp: '', dateImp: '' })]];
    expect(voyagesFromData(rows, 'Alcudia')).toHaveLength(0);
  });

  it('نموذجا المركبين مختلفان فعلاً لا شكلاً', () => {
    // بيلاجوس بلا ضريبة تفريغ وله منطقة حرة — وألكوديا العكس
    expect(SHEET_VESSELS.Pelagos.exportExp.freeZone2).toBe('fz');
    expect(SHEET_VESSELS.Pelagos.exportExp.dischargeOrderTax).toBeUndefined();
    expect(SHEET_VESSELS.Alcudia.exportExp.dischargeOrderTax).toBe('aa');
    expect(SHEET_VESSELS.Alcudia.exportExp.freeZone2).toBeUndefined();
  });
});
