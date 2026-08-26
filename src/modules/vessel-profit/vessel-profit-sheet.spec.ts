import { voyagesFromData, toSheetVoyage, monthOf, SHEET_VESSELS } from './vessel-profit-sheet';

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

/*
 * ── الشهر المشوَّه ──
 *
 * كُتب بعد حادثةٍ حقيقيّة: رحلة ألكوديا `#41` تحمل في الشيت
 * `dateExp = "204-11-27"` — خطأُ طباعةٍ تنقصه خانة. فصار شهرها `204-11`.
 *
 * والشهور تُرتَّب نصّاً، و`204-11` يسبق `2026-08` حرفاً بحرف، فوقع آخر الترتيب.
 * والشاشة تفتح على آخر شهر — فهبطت على دلوٍ فيه رحلةٌ واحدة، وبدت ٢٠٦ رحلاتٍ
 * من ٢٠٢٥ و٢٠٢٦ كأنّها اختفت.
 *
 * فسطرٌ واحدٌ مشوَّهٌ في دفترٍ يحرّره موظّفون يوميّاً كان يكفي ليخطف الشاشة.
 */
describe('الشهر المشوَّه لا يخطف الترتيب', () => {
  const spec = SHEET_VESSELS.Alcudia;

  it('`monthOf` يقبل الصالح ويردّ ما عداه', () => {
    expect(monthOf('2026-01-02')).toBe('2026-01');
    expect(monthOf('1999-12-31')).toBe('1999-12');
    // الحالة التي وقعت فعلاً
    expect(monthOf('204-11-27')).toBeNull();
    // شهرٌ خارج المدى، وسنةٌ خارج القرنين، وفراغ
    expect(monthOf('2026-13-01')).toBeNull();
    expect(monthOf('2026-00-01')).toBeNull();
    expect(monthOf('1899-05-01')).toBeNull();
    expect(monthOf('')).toBeNull();
    expect(monthOf(null)).toBeNull();
    expect(monthOf(undefined)).toBeNull();
  });

  const BROKEN = {
    vessel: 'ALCUDIA', ref: 41, year: null,
    dateExp: '204-11-27',   // مشوَّه — تنقصه خانة
    dateImp: '2024-11-28',  // سليم
  };

  it('تاريخ مغادرةٍ مشوَّه يرتدّ إلى تاريخ الوصول', () => {
    const v = toSheetVoyage(BROKEN, spec);
    expect(v.month).toBeNull();
    expect(v.monthAlt).toBe('2024-11');
  });

  it('الرحلة تُعرض في شهرها الصحيح ولا تُحذف', () => {
    const rows = [[null, null, null, null, null, null, null, null, null, null, JSON.stringify(BROKEN)]];
    const out = voyagesFromData(rows, 'Alcudia');
    expect(out).toHaveLength(1);
    expect(out[0].month).toBe('2024-11');
  });

  it('التاريخ المعروض هو الصالح لا المشوَّه', () => {
    expect(toSheetVoyage(BROKEN, spec).date).toBe('2024-11-28');
  });

  it('لم يعد يقع آخر الترتيب — وهو أصل العطب', () => {
    const rows = [
      [...Array(10).fill(null), JSON.stringify(BROKEN)],
      [...Array(10).fill(null), JSON.stringify({ vessel: 'ALCUDIA', ref: 90, dateExp: '2026-08-01', dateImp: '2026-08-02' })],
    ];
    const months = voyagesFromData(rows, 'Alcudia').map((v) => v.month!).sort();
    expect(months[months.length - 1]).toBe('2026-08');
  });

  it('تاريخان مشوَّهان معاً ⇒ الرحلة تُسقط من الشهور ولا تُختلق لها شهر', () => {
    const rows = [[...Array(10).fill(null), JSON.stringify({ vessel: 'ALCUDIA', ref: 7, dateExp: 'x', dateImp: '' })]];
    expect(voyagesFromData(rows, 'Alcudia')).toHaveLength(0);
  });
});

/*
 * ── بوسيدون ──
 *
 * حمولةٌ منسوخةٌ من رحلةٍ حقيقيّة في `DATA` (‏`POSEIDON` رقم ١ · ٢٠٢٥).
 *
 * والاختبار يحرس دعوى البناء: **خريطة بوسيدون هي خريطة ألكوديا نفسها**، وقد
 * قُورن رأسا الدفترين في الشيت فتطابقا. فإن انحرفت إحداهما عن الأخرى يوماً،
 * سقط اختبارٌ باسمه بدل أن يظهر بندٌ باسمٍ خاطئ في شاشةٍ ماليّة.
 */
const POSEIDON_ROW = {
  vessel: 'POSEIDON', ref: 1, year: 2025,
  dateExp: '2025-01-01', dateImp: '2025-01-01',
  nTruck: 219, nTruck_E: 111, nTruck_I: 108,
  nVeh: 27, nVeh_E: 3, nVeh_I: 24,
  nPax: 43, nPax_E: 10, nPax_I: 33,
  trE: 102150, vhE: 285, pxE: 800, dis: 0, dis_E: 0, dis_I: 0,
  trI: 71388, vhI: 4373.4, pxI: 2426.64,
  pkNo_E: 0, pkNo_I: 0,
  aa: 200, aa_E: 200, aa_I: 0,
  ad: 28.5, ad_E: 28.5, ad_I: 0,
  ae: 80, ae_E: 80, ae_I: 0,
  r: 7005.5, r_E: 0, r_I: 7005.5,
  s: 656.01, s_E: 0, s_I: 656.01,
  t: 485.33, t_E: 0, t_I: 485.33,
  fw: 226.67, fw_E: 0, fw_I: 226.67,
  eb: 1333, eb_E: 0, eb_I: 1333,
  tel: 230.12, tel_E: 0, tel_I: 230.12,
  oth: -3886.4, oth_E: 0, oth_I: -3886.4,
  pk: 5700.11, pk_E: 0, pk_I: 5700.11,
  pg: 11500, pg_E: 11500, pg_I: 0,
  bnk: 0, net: 157864.21, liq: 153554.71,
  collO: 165305.04, collP: 181423.04,
  line: 'ضبا/سفاجا', route: 'main', routeName: 'SFG/DUB',
  cashDuba: 0, cashSafaga: 0, overPax: 0, offHire: 0,
};

describe('بوسيدون — كارت الربحيّة التشغيليّ', () => {
  const spec = SHEET_VESSELS.Poseidon;

  it('مسجَّلٌ باسمه في الشيت', () => {
    expect(spec).toBeDefined();
    expect(spec.vessel).toBe('POSEIDON');
  });

  /*
   * الأسماء من ألكوديا، والفارق واحدٌ مقصود.
   *
   * قُورن رأسا الدفترين فتطابقا، فبنودُ المصروفات واحدة. لكنّ **الجانب** الذي
   * يُقرأ منه البند ليس واحداً: `ميناء السعودية` مقروءٌ من الوارد وحده في
   * ألكوديا وبيلاجوس — وهو صحيحٌ عندهما، فـ `pk_E` صفرٌ في ٤١٣ رحلةً لهما.
   *
   * وبوسيدون يسجّل منه على رِجل الصادر ١١٦٬٦٤٣.٧٠ في ١٦ رحلة. فنسخُ الخريطة
   * حرفيّاً كان يُسقطها صامتةً.
   */
  it('أسماء البنود من ألكوديا — والزيادة هي الجانبان لا بندٌ جديد', () => {
    const raw = (m: Record<string, string>) => [...new Set(Object.values(m))].sort();
    expect(raw(spec.exportExp)).toEqual(raw({ ...SHEET_VESSELS.Alcudia.exportExp, ksaPortE: 'pk' }));
    expect(raw(spec.importExp)).toEqual(raw({ ...SHEET_VESSELS.Alcudia.importExp, egyPortI: 'pg' }));
  });

  it('لا بندَ يُقرأ من جانبٍ واحد — فلا يسقط مالٌ صامتاً', () => {
    const e = new Set(Object.values(spec.exportExp));
    const i = new Set(Object.values(spec.importExp));
    const oneSided = [...new Set([...e, ...i])].filter((k) => !e.has(k) || !i.has(k));
    // ما بقي أحاديّ الجانب يجب أن يكون صفراً في الدفتر — وهذه قائمة المعلوم
    expect(oneSided.sort()).toEqual(['aa', 'ab', 'ac', 'ad', 'ae', 'brk', 'eb', 'fw', 'r', 's', 'sd', 't', 'tel']);
  });

  it('`ميناء السعودية` على رِجل الصادر لا يسقط', () => {
    const v = toSheetVoyage({ ...POSEIDON_ROW, pk_E: 8092.38, pk_I: 5700.11 }, spec);
    expect(v.E.exp.ksaPortE).toBe(8092.38);
    expect(v.I.exp.ksaPort).toBe(5700.11);
  });

  it('يُقرأ من `DATA` ولا يلتقط رحلات غيره', () => {
    const rows: any[][] = [
      [...Array(10).fill(null), JSON.stringify(POSEIDON_ROW)],
      [...Array(10).fill(null), JSON.stringify({ ...POSEIDON_ROW, vessel: 'ALCUDIA', ref: 9 })],
      [...Array(10).fill(null), JSON.stringify({ ...POSEIDON_ROW, vessel: 'AMAL', ref: 8 })],
    ];
    const out = voyagesFromData(rows, 'Poseidon');
    expect(out).toHaveLength(1);
    expect(out[0].ref).toBe(1);
    expect(out[0].month).toBe('2025-01');
  });

  it('يفصل رِجل الصادر عن الوارد بأعدادها ومصاريفها', () => {
    const v = toSheetVoyage(POSEIDON_ROW, spec);
    expect(v.E.truckC).toBe(111);
    expect(v.I.truckC).toBe(108);
    expect(v.E.exp.egyPort).toBe(11500);
    expect(v.I.exp.ksaPort).toBe(5700.11);
    expect(v.I.exp.comm10).toBe(7005.5);
    expect(v.E.exp.dischargeOrderTax).toBe(200);
  });

  /*
   * سبعة بنودٍ صفرٌ في رحلاته كلّها — تبقى في الخريطة ولا تُحذف.
   * فحذفُها يُخفي بنداً إن بدأ الدفتر يملؤه غداً.
   */
  it('البنود الفارغة تبقى معروضةً بصفرها', () => {
    const v = toSheetVoyage(POSEIDON_ROW, spec);
    for (const k of ['disShiOrder60', 'frtDep', 'broker']) expect(v.E.exp[k]).toBe(0);
    for (const k of ['specialDisc']) expect(v.I.exp[k]).toBe(0);
  });

  /*
   * ── ولا مفاهيمَ توزيعٍ هنا ──
   * الكارت تشغيليٌّ بقرار المالك: «كم ربح المركب هذا الشهر؟» — ونقدُ ضبا
   * وتحصيلُ صفاجا والـ Over Pax موضعها شاشة توزيع الأرباح وحدها.
   */
  it('لا يحمل نقد ضبا ولا صفاجا ولا Over Pax', () => {
    const v = toSheetVoyage(POSEIDON_ROW, spec) as any;
    expect(v.cashDuba).toBeUndefined();
    expect(v.cashSafaga).toBeUndefined();
    expect(v.overPax).toBeUndefined();
  });
});
