/**
 * الاختبار يُعيد إنتاج المستندات الورقيّة.
 *
 * الأرقام هنا منقولةٌ حرفياً من ملفّات التوزيع المعتمدة، لا من الكود ولا من
 * حسابٍ سابق. فإن انحرف المحرّك يوماً، انكسر الاختبار قبل أن ينكسر التوزيع.
 *
 * المصادر:
 *   Mar 2026 3rd & 4th Weeks Summary.pdf — ١٤ إلى ٢٧ مارس ٢٠٢٦
 *   July 1st , 2nd Weeks Summary.pdf     — ٤ إلى ١٧ يوليو ٢٠٢٦
 *   July 3rd,4th Weeks Summary-1.pdf     — ١٨ إلى ٣١ يوليو ٢٠٢٦
 *
 * وأساس العمولة والوقود في كلٍّ منها طوبق على تبويب DATA في الشيت الموحّد
 * فجاء `trE` و`bnk` مطابقَين بصفر فرق.
 */
import { calculateDistribution, daysBetween, VesselInput } from './profit-model';

const vessel = (o: Partial<VesselInput> & { key: string; name: string }): VesselInput => ({
  voyages: 0, sdBase: 0, sdAdjust: 0, fuel: 0, fuelAdjust: 0,
  cashDuba: 0, netCollected: 0, dailyRate: 0, ...o,
});

/** المستند يعرض بسنتين، فالتطابق يُقاس بسنتٍ واحد لا بأكثر. */
const near = (got: number, want: number, tol = 0.5) => {
  expect(Math.abs(got - want)).toBeLessThanOrEqual(tol);
};

describe('profit-model — معادلة المستند المعتمد', () => {
  describe('عدد الأيام', () => {
    it('يحسب الطرفين معاً: ١٨ إلى ٣١ يوليو = ١٤ يوماً', () => {
      expect(daysBetween('2026-07-18', '2026-07-31')).toBe(14);
      expect(daysBetween('2026-07-04', '2026-07-17')).toBe(14);
    });
    it('يعيد صفراً بلا تاريخ بدل أن يرمي', () => {
      expect(daysBetween('', '2026-07-31')).toBe(0);
      expect(daysBetween('2026-07-18', '')).toBe(0);
    });
  });

  /*
   * الفترة الحاسمة: هي وحدها التي تحمل Over Pax بمقدارٍ معلومٍ منصوصٍ عليه،
   * وهي وحدها التي يُطابق فيها سطرا «المخصوم من ضبا» و«المتبقّي» بالسنت.
   * فإن صحّت هذه الفترة صحّ البندان اللذان لم يكن لهما إثبات.
   */
  describe('١٤ – ٢٧ مارس ٢٠٢٦ — الفترة التي فيها Over Pax', () => {
    const result = calculateDistribution({
      days: 14,
      commissionRate: 6.5,
      perVoyageFee: 500,
      vessels: [
        vessel({
          key: 'amal', name: 'أمل', voyages: 5, dailyRate: 13000,
          sdBase: 406625.0,          // trE في الشيت — مطابق بصفر فرق
          fuel: 194989.79,           // bnk في الشيت — وهو الوقود الكلّيّ في المستند
          cashDuba: 482082.58,
          netCollected: 6119.58,
          revenue: 568997.06,
        }),
        vessel({
          key: 'poseidon', name: 'بوسيدون', voyages: 3, dailyRate: 14000,
          sdBase: 245375.0,
          // بنكر بوسيدون في الشيت ١٢٥٬٣٢٦.٨٤ والمستند لم يحمّله الفترة —
          // فيُستقطع تعديلاً معلَناً لا يُحذف بصمت
          fuel: 125326.84, fuelAdjust: -125326.84,
          cashDuba: 282391.99,
          netCollected: 6775.42,
          revenue: 351377.16,
          // رحلة بوسيدون رقم ٣٠: ١٠١ راكباً، صافي إيراد الزائدين ٦٬٤٤٢.٦٧
          overPax: 6442.67,
        }),
      ],
    });
    const amal = result.vessels.find((v) => v.key === 'amal')!;
    const pos = result.vessels.find((v) => v.key === 'poseidon')!;

    it('نصّ المستند: ٦٦.٦٧٪ لبدوي و٣٣.٣٣٪ للاتحاد', () => {
      near(pos.overPaxShare, 4295.33, 0.02);
      near(amal.overPaxShare, 2147.34, 0.02);
      near(result.totalOverPax, 6442.67);
    });
    it('الأساس المشترك ٣٨٢٬٢٣٧.٢٩ — نصفا نقد ضبا', () => {
      near(result.baseShare, 382237.29);
      near(result.totalCashDuba, 764474.57);
    });
    it('معدّل الربح يفترق بين الشريكين بمقدار Over Pax', () => {
      near(amal.adjustedProfit, 384384.63, 0.02);
      near(pos.adjustedProfit, 386532.61, 0.02);
    });
    it('حصص الإيجار والوقود والعمولة كما في المستند', () => {
      near(result.rentShare, 189000.0);
      near(result.fuelShare, 97494.9);
      near(result.feeShare, 23190.0);
      near(amal.fee, 28930.63);
      near(pos.fee, 17449.38);
    });
    it('تسوية صفاجا ±٣٢٧.٩٢', () => {
      near(amal.safagaAdjust, 327.92);
      near(pos.safagaAdjust, -327.92);
    });
    it('التوزيع المكتوب: أمل ٧٥٬٠٢٧ · بوسيدون ٧٦٬٥١٩', () => {
      expect(amal.dividendPayable).toBe(75027);
      expect(pos.dividendPayable).toBe(76519);
    });
    it('المتبقّي في ضبا ٠.٦٥ و٠.٨٠ — كسرُ التدوير كما يكتبه المستند', () => {
      near(amal.remainingAtDuba, 0.65, 0.02);
      near(pos.remainingAtDuba, 0.8, 0.02);
    });
    it('المخصوم من ضبا: ٣٨٤٬٧١١.٩٠ و٣٨٦٬٢٠٣.٨٩', () => {
      near(amal.deductedFromDuba, 384711.9, 0.02);
      near(pos.deductedFromDuba, 386203.89, 0.02);
    });
    it('التعديل اليدويّ على وقود بوسيدون يُعلَن', () => {
      expect(pos.fuel).toBe(0);
      expect(result.warnings.some((w) => w.includes('تعديلٌ يدويّ'))).toBe(true);
    });
  });

  describe('٤ – ١٧ يوليو ٢٠٢٦', () => {
    const result = calculateDistribution({
      days: 14,
      commissionRate: 6.5,
      perVoyageFee: 500,
      vessels: [
        vessel({
          key: 'amal', name: 'أمل', voyages: 4, dailyRate: 13000,
          sdBase: 386805.0,        // trE في الشيت — مطابق بصفر فرق
          fuel: 0.0,               // bnk — لا بنكر في الفترة
          cashDuba: 537455.12,
          netCollected: 95222.05,
          revenue: 718261.44,
          liquidity: 537455.11,    // liq في الشيت — يقارب نقد ضبا بسنت
        }),
        vessel({
          key: 'poseidon', name: 'بوسيدون', voyages: 4, dailyRate: 14000,
          sdBase: 355881.0,
          fuel: 51861.38,
          cashDuba: 678819.43,
          netCollected: 76029.7,
          revenue: 877795.34,
        }),
      ],
    });
    const amal = result.vessels.find((v) => v.key === 'amal')!;
    const pos = result.vessels.find((v) => v.key === 'poseidon')!;

    it('شريكان فقط — دليلة خارج القسمة', () => {
      expect(result.partners).toBe(2);
    });
    it('معدّل الربح = ٦٠٨٬١٣٧.٢٨ للطرفين', () => {
      near(result.baseShare, 608137.28);
    });
    it('حصّة الإيجار = ١٨٩٬٠٠٠', () => {
      near(result.rentShare, 189000.0);
      near(amal.rent, 182000.0);
      near(pos.rent, 196000.0);
    });
    it('حصّة الوقود = ٢٥٬٩٣٠.٦٩', () => {
      near(result.fuelShare, 25930.69);
    });
    it('العمولة: أمل ٢٧٬١٤٢.٣٣ · بوسيدون ٢٥٬١٣٢.٢٧ · الحصّة ٢٦٬١٣٧.٣٠', () => {
      near(amal.fee, 27142.33);
      near(pos.fee, 25132.27);
      near(result.feeShare, 26137.3);
    });
    it('تسوية صفاجا = ∓٩٬٥٩٦.١٨', () => {
      near(amal.safagaAdjust, -9596.18);
      near(pos.safagaAdjust, 9596.18);
    });
    it('التوزيع: أمل ٣٥٧٬٤٧٢.٧١ · بوسيدون ٣٧٦٬٦٦٥.٣٣', () => {
      near(amal.dividendPayable, 357472.71, 0.5);
      near(pos.dividendPayable, 376665.33, 0.5);
    });
    it('المخصوم من ضبا يفرغ الرصيد', () => {
      near(amal.remainingAtDuba, 0.41, 0.5);
      near(pos.remainingAtDuba, 0.14, 0.5);
    });
    it('لا مدخلاتٍ ناقصة ولا تعديلاتٍ يدويّة', () => {
      expect(result.missing).toEqual([]);
      expect(result.warnings).toEqual([]);
    });
  });

  describe('١٨ – ٣١ يوليو ٢٠٢٦', () => {
    const result = calculateDistribution({
      days: 14,
      commissionRate: 6.5,
      perVoyageFee: 500,
      vessels: [
        vessel({
          key: 'amal', name: 'أمل', voyages: 5, dailyRate: 13000,
          sdBase: 507055.0,
          fuel: 114060.84,
          cashDuba: 686963.32,
          netCollected: 155965.04,
          revenue: 953520.61,
          liquidity: 696618.22,
        }),
        vessel({
          key: 'poseidon', name: 'بوسيدون', voyages: 4, dailyRate: 14000,
          sdBase: 475750.0,
          fuel: 224744.78,
          cashDuba: 784647.41,
          netCollected: 157468.88,
          revenue: 1074201.54,
          liquidity: 792948.03,
        }),
      ],
    });
    const amal = result.vessels.find((v) => v.key === 'amal')!;
    const pos = result.vessels.find((v) => v.key === 'poseidon')!;

    it('معدّل الربح = ٧٣٥٬٨٠٥.٣٧', () => {
      near(result.baseShare, 735805.37);
      near(result.totalCashDuba, 1471610.73);
    });
    it('حصّة الوقود = ١٦٩٬٤٠٢.٨١', () => {
      near(result.fuelShare, 169402.81);
    });
    it('العمولة: أمل ٣٥٬٤٥٨.٥٨ · بوسيدون ٣٢٬٩٢٣.٧٥ · الحصّة ٣٤٬١٩١.١٦', () => {
      near(amal.fee, 35458.58);
      near(pos.fee, 32923.75);
      near(result.feeShare, 34191.16);
    });
    it('تسوية صفاجا = ±٧٥١.٩٢', () => {
      near(amal.safagaAdjust, 751.92);
      near(pos.safagaAdjust, -751.92);
    });
    it('التوزيع: أمل ٣٤٣٬٩٦٢.٩٩ · بوسيدون ٣٤٢٬٤٥٩.٠٥', () => {
      near(amal.dividendPayable, 343962.99, 0.5);
      near(pos.dividendPayable, 342459.05, 0.5);
    });
    it('المخصوم من ضبا: أمل ٧٣٦٬٥٥٦.٩٧ · بوسيدون ٧٣٥٬٠٥٣.٠٣', () => {
      near(amal.deductedFromDuba, 736556.97);
      near(pos.deductedFromDuba, 735053.03);
    });
    it('لا يضيع دولار: المستحقّ + المتبقّي = نقد ضبا و Over Pax', () => {
      const due = result.vessels.reduce((a, v) => a + v.dueToAccount, 0);
      const left = result.vessels.reduce((a, v) => a + v.remainingAtDuba, 0);
      near(due + left, result.totalCashDuba + result.totalOverPax, 0.05);
    });
    it('فرق السيولة يُعرض ولا يُحتسب', () => {
      near(amal.liquidityGap!, 9654.9);
      near(pos.liquidityGap!, 8300.62);
    });
  });

  describe('التعديل اليدويّ — حالة ٢٠ يونيو – ٣ يوليو', () => {
    /*
     * الفترة الوحيدة التي خالف فيها المستند دفترَ الرحلات، وسببه مكتوبٌ فيه:
     *   أساس أمل زاد ١١٩٬٣٣٦.٣٢ — وهو حرفياً `Net Collected — Amal`
     *   وقود أمل نقص ١٧٩٬٥٥٦.١١ — والرقم مطبوعٌ في المستند بنداً مستقلّاً
     * تسويتان بشريّتان، والمحرّك يستوعبهما ويُعلنهما لا يبتلعهما.
     */
    const result = calculateDistribution({
      days: 14, commissionRate: 6.5, perVoyageFee: 500,
      vessels: [
        vessel({
          key: 'amal', name: 'أمل', voyages: 5, dailyRate: 13000,
          sdBase: 498580.0, sdAdjust: 119336.32,
          fuel: 305214.16, fuelAdjust: -179556.11,
          cashDuba: 630304.0, netCollected: 119336.32,
        }),
        vessel({
          key: 'poseidon', name: 'بوسيدون', voyages: 5, dailyRate: 14000,
          sdBase: 589985.0, fuel: 137030.47,
          cashDuba: 876600.0, netCollected: 85097.59,
        }),
      ],
    });
    const amal = result.vessels.find((v) => v.key === 'amal')!;

    it('الأساس بعد التعديل = ٦١٧٬٩١٦.٣٢ كما في المستند', () => {
      near(amal.sdBase, 617916.32);
      near(amal.fee, 42664.56);
    });
    it('الوقود بعد التعديل = ١٢٥٬٦٥٨.٠٥ كما في المستند', () => {
      near(amal.fuel, 125658.05);
      near(result.fuelShare, 131344.26);
    });
    it('التعديل اليدويّ يُعلَن تنبيهاً', () => {
      expect(result.warnings.some((w) => w.includes('تعديلٌ يدويّ'))).toBe(true);
    });
  });

  /*
   * سؤال الإدارة: ماذا كان يجني المركب لو عمل وحده؟
   *
   * والخاصّيّة التي تحرسه: **المجموع صفريّ**. ما تكسبه سفينةٌ من الشراكة تخسره
   * الأخرى بالضبط — فالشراكة تنقل ولا تخلق. وأيّ خللٍ في الاشتقاق يكسر ذلك.
   */
  /*
   * خمسة مستنداتٍ وصلت في ٢٢ أغسطس ٢٠٢٦، وكشفت خطأً في اتّجاه قسمة Over Pax.
   *
   * كان المحرّك يُعطي ما نشأ على أمل **كلّه** للاتحاد — بُني على مستندٍ واحد
   * نشأ فيه Over Pax على بوسيدون وحده، فلم تُرَ الحالة المقابلة. والقاعدة:
   * ٦٦.٦٧٪ لشريك المركب الذي نشأ عليه، و٣٣.٣٣٪ للآخر — والاتّجاه ينقلب معه.
   *
   * ولا تدخل القسمة إلا **حصّة ضبا** من Over Pax؛ ما حُصّل في صفاجا يبقى خارجها.
   */
  describe('مستنداتٌ تُثبت اتّجاه قسمة Over Pax', () => {
    /** المشترك بين الفترات: لا عمولة في هذه المستندات، والوقود يُدخَل مباشرةً. */
    const period = (o: {
      days: number;
      amal: { duba: number; coll: number; op?: number; fuel: number; voy: number };
      pos: { duba: number; coll: number; op?: number; fuel: number; voy: number };
      fee?: number;
    }) => calculateDistribution({
      days: o.days, commissionRate: 6.5, perVoyageFee: o.fee ?? 0,
      vessels: [
        vessel({ key: 'amal', name: 'أمل', voyages: o.amal.voy, dailyRate: 13000,
          fuel: o.amal.fuel, cashDuba: o.amal.duba, netCollected: o.amal.coll,
          overPax: o.amal.op ?? 0 }),
        vessel({ key: 'poseidon', name: 'بوسيدون', voyages: o.pos.voy, dailyRate: 14000,
          fuel: o.pos.fuel, cashDuba: o.pos.duba, netCollected: o.pos.coll,
          overPax: o.pos.op ?? 0 }),
      ],
    });
    const of = (r: ReturnType<typeof calculateDistribution>, k: string) =>
      r.vessels.find((v) => v.key === k)!;

    /*
     * ٣١ يناير – ١٣ فبراير ٢٠٢٦
     * «MV Amal Voy.#02 … ١٤٨ راكباً … ١٨٬٦٣٧.٨٩ تُقسم ٦٦.٦٧٪ للاتحاد و٣٣.٣٣٪ لبدوي»
     * وهي الحالة التي كشفت الخطأ: Over Pax نشأ على **أمل**.
     */
    it('٣١ يناير – ١٣ فبراير · Over Pax على أمل', () => {
      const r = period({
        days: 14,
        amal: { duba: 154873.84, coll: 0, op: 18637.88, fuel: 0, voy: 2 },
        pos: { duba: 392683.89, coll: -41089.79, fuel: 136085.62, voy: 6 },
      });
      const a = of(r, 'amal'), p = of(r, 'poseidon');
      near(a.overPaxShare, 12425.87, 0.02);   // ٦٦.٦٧٪ للاتحاد
      near(p.overPaxShare, 6212.01, 0.02);    // ٣٣.٣٣٪ لبدوي
      near(a.adjustedProfit, 286204.74, 0.02);
      near(p.adjustedProfit, 279990.87, 0.02);
      near(r.fuelShare, 68042.81);
      near(a.safagaAdjust, -20544.90);
      expect(a.dividendPayable).toBe(8617);
      expect(p.dividendPayable).toBe(43492);
      near(a.remainingAtDuba, 0.03, 0.02);
      near(p.remainingAtDuba, 0.96, 0.02);
    });

    /*
     * ١٤ – ٢٧ فبراير ٢٠٢٦ — الفترة الوحيدة التي نشأ فيها Over Pax على المركبين معاً.
     * أمل ٣ و٥ → ٣٣٬٠٥٠.٨٣ · بوسيدون ١٦ → ٦٬٣٨٩.٥١ ومنه ٤٬٩٨١.٠٥ في صفاجا،
     * فالداخل من بوسيدون ١٬٤٠٨.٤٦ وحدها.
     */
    it('١٤ – ٢٧ فبراير · Over Pax على المركبين، والاتّجاهان معاً', () => {
      const r = period({
        days: 14,
        amal: { duba: 284041.05, coll: 0, op: 33050.83, fuel: 0, voy: 3 },
        pos: { duba: 656127.70, coll: -51966.21, op: 1408.46, fuel: 136872.23, voy: 7 },
      });
      const a = of(r, 'amal'), p = of(r, 'poseidon');
      // أمل: ٦٦.٦٧٪ من ٣٣٬٠٥٠.٨٣ + ٣٣.٣٣٪ من ١٬٤٠٨.٤٦
      near(a.overPaxShare, 22504.27, 0.35);
      near(p.overPaxShare, 11954.56, 0.35);
      near(a.adjustedProfit, 492588.65, 0.35);
      near(p.adjustedProfit, 482038.93, 0.35);
      /*
       * وتسوية صفاجا هنا لا تُطابق: المستند ‎(٢٤٬٣٢٢.٩٢)‎ والمحرّك ‎(٢٥٬٩٨٣.١١)‎.
       * والفرق ١٬٦٦٠.١٨ = ٣٣.٣٣٪ من ٤٬٩٨١.٠٥، وهي حصّة Over Pax **المحصَّلة في
       * صفاجا**. فالمستند يُدخلها في جانب صفاجا لا في وعاء ضبا.
       *
       * ولم تُنمذَج: نقطتا بيانٍ لا تكفيان لقاعدة، والمستند يحسبها لأمل ويعكسها
       * لبوسيدون بدل أن يشتقّها لكلٍّ — فصيغةٌ عامّة منهما تخمين.
       */
      near(a.safagaAdjust + 1660.18, -24322.92, 0.35);
    });

    /*
     * ٢٨ فبراير – ١٣ مارس ٢٠٢٦ · أمل ٦ و٧ و٨ → ٤٦٬٣٣٩.٧٨ كلّه في ضبا.
     * تُطابق بالسنت — ولا شيء فيها يحتاج تسامحاً.
     */
    it('٢٨ فبراير – ١٣ مارس · بالسنت', () => {
      const r = period({
        days: 14,
        amal: { duba: 342146.37, coll: 0, op: 46339.78, fuel: 0, voy: 4 },
        pos: { duba: 512367.37, coll: -19534.05, fuel: 102682.63, voy: 6 },
      });
      const a = of(r, 'amal'), p = of(r, 'poseidon');
      near(a.overPaxShare, 30894.73, 0.02);
      near(p.overPaxShare, 15445.05, 0.02);
      near(a.adjustedProfit, 458151.60, 0.02);
      near(p.adjustedProfit, 442701.92, 0.02);
      near(r.fuelShare, 51341.32);
      expect(a.dividendPayable).toBe(208043);
      expect(p.dividendPayable).toBe(212127);
      near(a.remainingAtDuba, 0.26, 0.02);
      near(p.remainingAtDuba, 0.63, 0.02);
    });

    /*
     * ٢٠ يونيو – ٣ يوليو ٢٠٢٦ · بوسيدون ٦٣ و٦٤ → ١٧٬٧١١.٧٦، منه ١٦٬٤٨٥.٣٤ في
     * ضبا. وهذه الفترة عجز عنها المحرّك قبل أن تصل أرقام ضبا الدقيقة.
     */
    it('٢٠ يونيو – ٣ يوليو · وحصّة ضبا وحدها تدخل', () => {
      /*
       * ووقود أمل هنا **بنكر الدفتر كاملاً** ٣٠٥٬٢١٤.١٦، لا ١٢٥٬٦٥٨.٠٥ التي
       * يعرضها سطر `Fuel Supply` في المستند. والدليل حصّة الوقود نفسها:
       * ٢٢١٬١٢٢.٣٢ × ٢ = ٤٤٢٬٢٤٤.٦٤ = ٣٠٥٬٢١٤.١٦ + ١٣٧٬٠٣٠.٤٧.
       *
       * فسطر العرض في المستند ليس أساس القسمة دائماً — والأساس هو البنكر.
       */
      const r = period({
        days: 14, fee: 500,
        amal: { duba: 630303.15, coll: 119336.32, fuel: 305214.16, voy: 5 },
        pos: { duba: 876600.95, coll: 85097.59, op: 16485.34, fuel: 137030.47, voy: 5 },
      });
      const a = of(r, 'amal'), p = of(r, 'poseidon');
      near(a.overPaxShare, 5494.56, 0.02);
      near(p.overPaxShare, 10990.78, 0.02);
      near(a.adjustedProfit, 758946.61, 0.02);
      near(p.adjustedProfit, 764442.83, 0.02);
      near(r.fuelShare, 221122.32, 0.02);
      // والفرق ٤٠٨.٧٧ = ٣٣.٣٣٪ من ١٬٢٢٦.٤٢ المحصَّلة في صفاجا — كفبراير سواءً
      near(a.safagaAdjust + 408.77, -16710.60, 0.02);
    });

    /*
     * ٩ – ٢٩ مايو ٢٠٢٦ · إحدى وعشرون يوماً بلا Over Pax — تُثبت أنّ عدد الأيّام
     * ليس أربعة عشر دائماً، وأنّ الإيجار والعمولة يتبعانه.
     */
    it('٩ – ٢٩ مايو · ٢١ يوماً وبلا Over Pax', () => {
      const r = calculateDistribution({
        days: 21, commissionRate: 6.5, perVoyageFee: 500,
        vessels: [
          vessel({ key: 'amal', name: 'أمل', voyages: 6, dailyRate: 13000,
            sdBase: 0, fuel: 141907.44, cashDuba: 724856.02, netCollected: 81237.23 }),
          vessel({ key: 'poseidon', name: 'بوسيدون', voyages: 7, dailyRate: 14000,
            sdBase: 1193833.00, fuel: 452484.90, cashDuba: 1142806.87, netCollected: 104176.24 }),
        ],
      });
      const a = of(r, 'amal'), p = of(r, 'poseidon');
      near(r.totalCashDuba, 1867662.89);
      near(a.adjustedProfit, 933831.45, 0.02);
      near(p.adjustedProfit, 933831.45, 0.02);
      near(a.rent, 273000);
      near(p.rent, 294000);
      near(r.rentShare, 283500);
      near(r.fuelShare, 297196.17);
      near(r.feeShare, 42049.57, 0.02);   // ١٬١٩٣٬٨٣٣ × ٦.٥٪ + ١٣ × ٥٠٠ ÷ ٢
      near(a.safagaAdjust, 11469.51, 0.02);
      near(a.dividendPayable, 322554.33, 1.0);
      near(p.dividendPayable, 299615.53, 1.0);
    });
  });

  describe('أثر الشراكة — منفرداً مقابل شراكةً', () => {
    const result = calculateDistribution({
      days: 14, commissionRate: 6.5, perVoyageFee: 500,
      vessels: [
        vessel({ key: 'amal', name: 'أمل', voyages: 5, dailyRate: 13000,
          sdBase: 507055, fuel: 114060.84, cashDuba: 696618.22, netCollected: 143066.14 }),
        vessel({ key: 'poseidon', name: 'بوسيدون', voyages: 4, dailyRate: 14000,
          sdBase: 475750, fuel: 224744.78, cashDuba: 792948.03, netCollected: 157468.89 }),
      ],
    });
    const amal = result.vessels.find((v) => v.key === 'amal')!;
    const pos = result.vessels.find((v) => v.key === 'poseidon')!;

    it('منفرداً = نقده وتحصيله ناقص إيجاره ووقوده وعمولته', () => {
      // 792,948.03 + 157,468.89 − 196,000 − 224,744.78 − (475,750×6.5% + 4×500)
      near(pos.standalone, 496748.39);
      near(amal.standalone, 508164.94);
    });

    it('شراكةً = التوزيع مع تحصيله', () => {
      near(pos.partnered, pos.dividend + 157468.89, 0.02);
      near(amal.partnered, amal.dividend + 143066.14, 0.02);
    });

    it('المجموع صفريّ — الشراكة تنقل ولا تخلق', () => {
      const gains = result.vessels.reduce((a, v) => a + v.partnershipGain, 0);
      near(gains, 0, 0.02);
    });

    it('من يدعم من: بوسيدون رابح وأمل خاسر في هذه الفترة', () => {
      expect(pos.partnershipGain).toBeGreaterThan(0);
      expect(amal.partnershipGain).toBeLessThan(0);
      near(pos.partnershipGain, -amal.partnershipGain, 0.02);
    });

    it('مركبٌ واحد: لا شراكة فلا فرق', () => {
      const solo = calculateDistribution({
        days: 14, commissionRate: 6.5, perVoyageFee: 500,
        vessels: [
          vessel({ key: 'poseidon', name: 'بوسيدون', voyages: 4, dailyRate: 14000,
            sdBase: 475750, fuel: 224744.78, cashDuba: 792948.03, netCollected: 157468.89 }),
        ],
      });
      expect(solo.partners).toBe(1);
      near(solo.vessels[0].partnershipGain, 0, 0.02);
    });

    it('ثلاثة شركاء: المجموع يبقى صفريّاً', () => {
      const three = calculateDistribution({
        days: 14, commissionRate: 6.5, perVoyageFee: 500,
        vessels: [
          vessel({ key: 'amal', name: 'أمل', voyages: 5, dailyRate: 13000,
            sdBase: 507055, fuel: 114060.84, cashDuba: 696618.22, netCollected: 143066.14 }),
          vessel({ key: 'poseidon', name: 'بوسيدون', voyages: 4, dailyRate: 14000,
            sdBase: 475750, fuel: 224744.78, cashDuba: 792948.03, netCollected: 157468.89 }),
          vessel({ key: 'daleela', name: 'دليلة', voyages: 3, dailyRate: 12000,
            sdBase: 200000, fuel: 40000, cashDuba: 300000, netCollected: 50000 }),
        ],
      });
      expect(three.partners).toBe(3);
      const gains = three.vessels.reduce((a, v) => a + v.partnershipGain, 0);
      near(gains, 0, 0.05);
    });
  });

  describe('الحراسة على المدخلات', () => {
    it('غياب نقد ضبا يُعلَن نقصاً لا يُعرض رقماً سالباً كحقيقة', () => {
      const r = calculateDistribution({
        days: 14, commissionRate: 6.5, perVoyageFee: 500,
        vessels: [
          vessel({ key: 'amal', name: 'أمل', voyages: 5, dailyRate: 13000, sdBase: 507055 }),
          vessel({ key: 'poseidon', name: 'بوسيدون', voyages: 4, dailyRate: 14000, sdBase: 475750 }),
        ],
      });
      expect(r.missing.length).toBeGreaterThan(0);
      expect(r.missing[0]).toContain('نقد ضبا');
    });

    it('المركب الراسي لا يدخل القسمة فلا يرفع نصيب الباقين', () => {
      const withIdle = calculateDistribution({
        days: 14, commissionRate: 6.5, perVoyageFee: 500,
        vessels: [
          vessel({ key: 'amal', name: 'أمل', voyages: 5, dailyRate: 13000,
            sdBase: 507055, fuel: 114060.84, cashDuba: 686963.32, netCollected: 155965.04 }),
          vessel({ key: 'poseidon', name: 'بوسيدون', voyages: 4, dailyRate: 14000,
            sdBase: 475750, fuel: 224744.78, cashDuba: 784647.41, netCollected: 157468.88 }),
          vessel({ key: 'daleela', name: 'دليلة', dailyRate: 12000 }),
        ],
      });
      expect(withIdle.partners).toBe(2);
      near(withIdle.baseShare, 735805.37);
      near(withIdle.rentShare, 189000);
    });

    it('Over Pax لا يُضاف ولا يُنقص — مجموع الحصص يساوي المنشأ', () => {
      const r = calculateDistribution({
        days: 14, commissionRate: 6.5, perVoyageFee: 500,
        vessels: [
          vessel({ key: 'amal', name: 'أمل', voyages: 5, dailyRate: 13000,
            sdBase: 507055, fuel: 114060.84, cashDuba: 686963.32, netCollected: 155965.04 }),
          vessel({ key: 'poseidon', name: 'بوسيدون', voyages: 4, dailyRate: 14000,
            sdBase: 475750, fuel: 224744.78, cashDuba: 784647.41,
            netCollected: 157468.88, overPax: 17711.76 }),
        ],
      });
      const shares = r.vessels.reduce((a, v) => a + v.overPaxShare, 0);
      near(shares, 17711.76, 0.02);
      near(r.baseShare, 735805.37);
    });

    /*
     * دليلة شريكاً ثالثاً مع Over Pax: لا مستندَ يُبيّن قسمته حينئذٍ.
     * فيبقى على منشئه ويُعلَن — ولا يُخمَّن توزيعٌ يمسّ مالاً حقيقياً.
     */
    it('الحال التي لا مستندَ لها تُعلَن ولا تُخمَّن', () => {
      const r = calculateDistribution({
        days: 14, commissionRate: 6.5, perVoyageFee: 500,
        vessels: [
          vessel({ key: 'amal', name: 'أمل', voyages: 5, dailyRate: 13000,
            cashDuba: 100000, netCollected: 0 }),
          vessel({ key: 'poseidon', name: 'بوسيدون', voyages: 4, dailyRate: 14000,
            cashDuba: 100000, netCollected: 0, overPax: 6000 }),
          vessel({ key: 'daleela', name: 'دليلة', voyages: 3, dailyRate: 12000,
            cashDuba: 100000, netCollected: 0 }),
        ],
      });
      expect(r.partners).toBe(3);
      expect(r.warnings.some((w) => w.includes('Over Pax'))).toBe(true);
      expect(r.vessels.find((v) => v.key === 'poseidon')!.overPaxShare).toBe(6000);
      expect(r.vessels.find((v) => v.key === 'amal')!.overPaxShare).toBe(0);
    });

    it('تسوية الإيقاف تُخزَّن وتُعلَن ولا تدخل الحساب', () => {
      const r = calculateDistribution({
        days: 14, commissionRate: 6.5, perVoyageFee: 500,
        vessels: [
          vessel({ key: 'amal', name: 'أمل', voyages: 5, dailyRate: 13000,
            sdBase: 507055, fuel: 114060.84, cashDuba: 686963.32,
            netCollected: 155965.04, offHireSettlement: 5000 }),
          vessel({ key: 'poseidon', name: 'بوسيدون', voyages: 4, dailyRate: 14000,
            sdBase: 475750, fuel: 224744.78, cashDuba: 784647.41, netCollected: 157468.88 }),
        ],
      });
      expect(r.warnings.some((w) => w.includes('تسوية إيقاف'))).toBe(true);
      expect(r.vessels.find((v) => v.key === 'amal')!.dividendPayable).toBe(343963);
    });

    it('المدخل غير الرقميّ يصير صفراً ولا يُنتج NaN', () => {
      const r = calculateDistribution({
        days: 14, commissionRate: 6.5, perVoyageFee: 500,
        vessels: [
          vessel({ key: 'amal', name: 'أمل', voyages: 5, dailyRate: 13000,
            sdBase: 'x' as unknown as number, fuel: NaN, cashDuba: 686963.32, netCollected: 0 }),
          vessel({ key: 'poseidon', name: 'بوسيدون', voyages: 4, dailyRate: 14000,
            sdBase: 475750, fuel: 224744.78, cashDuba: 784647.41, netCollected: 0 }),
        ],
      });
      for (const v of r.vessels) {
        expect(Number.isFinite(v.dividend)).toBe(true);
        expect(Number.isFinite(v.fee)).toBe(true);
      }
    });
  });
});
