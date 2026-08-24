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
import {
  calculateDistribution, calculateProposed, daysBetween,
  VesselInput, ProposedResult,
} from './profit-model';

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
   * ستّة مستنداتٍ تُثبت المعادلة كلّها — ما عدا وجهة Over Pax.
   *
   * **القاعدة المعتمدة بقرار المالك: ٦٦.٦٧٪ لبدوي و٣٣.٣٣٪ للاتحاد، دائماً.**
   * لا تنقلب بمنشأ الرحلة، وتُطبَّق على مبلغ Over Pax وحده.
   *
   * وثلاثة مستنداتٍ نشأ فيها Over Pax على أمل تحسبها بالمنشأ فتعكس النسبتين.
   * عُرض التعارض على المالك بأرقامه فأكّد القاعدة الثابتة، فالنظام يتبعها
   * ويخالفها. ولهذا تُبقي هذه الاختبارات **رقم المستند مكتوباً بجوار رقم
   * النظام** في كلّ حالةٍ يفترقان فيها، حتّى يبقى الفرق موثَّقاً لا منسيّاً.
   *
   * ولا تدخل القسمة إلا **حصّة ضبا** من Over Pax؛ ما حُصّل في صفاجا يبقى خارجها.
   */
  describe('مستنداتٌ تُثبت المعادلة — ووجهة Over Pax بقرار المالك', () => {
    /** المشترك بين الفترات: لا عمولة في هذه المستندات، والوقود يُدخَل مباشرةً. */
    type Side = {
      duba: number; coll: number; op?: number; opSaf?: number;
      fuel: number; voy: number; sd?: number; fs?: number;
    };
    const period = (o: { days: number; amal: Side; pos: Side; fee?: number }) =>
      calculateDistribution({
        days: o.days, commissionRate: 6.5, perVoyageFee: o.fee ?? 0,
        vessels: [
          vessel({ key: 'amal', name: 'أمل', voyages: o.amal.voy, dailyRate: 13000,
            sdBase: o.amal.sd ?? 0,
            fuel: o.amal.fuel, cashDuba: o.amal.duba, netCollected: o.amal.coll,
            overPax: o.amal.op ?? 0, overPaxSafaga: o.amal.opSaf ?? 0,
            fuelSupply: o.amal.fs ?? 0 }),
          vessel({ key: 'poseidon', name: 'بوسيدون', voyages: o.pos.voy, dailyRate: 14000,
            sdBase: o.pos.sd ?? 0,
            fuel: o.pos.fuel, cashDuba: o.pos.duba, netCollected: o.pos.coll,
            overPax: o.pos.op ?? 0, overPaxSafaga: o.pos.opSaf ?? 0,
            fuelSupply: o.pos.fs ?? 0 }),
        ],
      });
    const of = (r: ReturnType<typeof calculateDistribution>, k: string) =>
      r.vessels.find((v) => v.key === k)!;

    /*
     * ٣١ يناير – ١٣ فبراير ٢٠٢٦
     * «MV Amal Voy.#02 … ١٤٨ راكباً … ١٨٬٦٣٧.٨٩ تُقسم ٦٦.٦٧٪ للاتحاد و٣٣.٣٣٪ لبدوي»
     * ونشأ على **أمل** — فالنظام يعكس المستند: الأكبر لبدوي دائماً.
     */
    it('٣١ يناير – ١٣ فبراير · Over Pax على أمل — والنظام يخالف المستند', () => {
      const r = period({
        days: 14,
        amal: { duba: 154873.84, coll: 0, op: 18637.88, fuel: 0, voy: 2 },
        pos: { duba: 392683.89, coll: -41089.79, fuel: 136085.62, voy: 6 },
      });
      const a = of(r, 'amal'), p = of(r, 'poseidon');
      // المستند: أمل ١٢٬٤٢٥.٨٧ وبوسيدون ٦٬٢١٢.٠١ — والنظام يعكسهما بالقاعدة الثابتة
      near(p.overPaxShare, 12425.87, 0.02);   // ٦٦.٦٧٪ لبدوي
      near(a.overPaxShare, 6212.01, 0.02);    // ٣٣.٣٣٪ للاتحاد
      near(p.adjustedProfit, 286204.74, 0.02);  // رقم المستند لأمل
      near(a.adjustedProfit, 279990.87, 0.02);  // رقم المستند لبوسيدون
      // وما عدا الوجهة يُطابق المستند كما هو
      near(r.fuelShare, 68042.81);
      near(a.safagaAdjust, -20544.90);
      // والمستند يوزّع ٨٬٦١٧ و٤٣٬٤٩٢ — والفرق ٦٬٢١٣.٨٦ ينتقل من أمل إلى بوسيدون
      expect(a.dividendPayable).toBe(2403);
      expect(p.dividendPayable).toBe(49706);
      near(a.remainingAtDuba, 0.17, 0.02);
      near(p.remainingAtDuba, 0.82, 0.02);
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
        pos: { duba: 656127.70, coll: -51966.21, op: 1408.46, opSaf: 4981.05,
          fuel: 136872.23, voy: 7 },
      });
      const a = of(r, 'amal'), p = of(r, 'poseidon');
      /*
       * المستند يقسم بالمنشأ: أمل ٢٢٬٥٠٤.٢٧ وبوسيدون ١١٬٩٥٤.٥٦.
       * والقاعدة الثابتة تقسم **المجموع** ٣٤٬٤٥٩.٢٩ لا كلّ مبلغٍ على حدة —
       * فينتقل ١١٬٠١٨.٩٩ (٣٣.٣٤٪ من ٣٣٬٠٥٠.٨٣) من أمل إلى بوسيدون،
       * ويبقى نصيب ما نشأ على بوسيدون كما هو لأنّ وجهته لم تتغيّر.
       */
      near(a.overPaxShare, 22504.27 - 11018.99, 0.35);
      near(a.adjustedProfit, 492588.65 - 11018.99, 0.35);
      /*
       * وحصّتا المستند تجمعان ٣٤٬٤٥٨.٨٣ بينما مدخلاته تجمع ٣٤٬٤٥٩.٢٩ — نقصٌ
       * قدره ٠.٤٦ داخل المستند نفسه، يقع كلّه على جانب بوسيدون. فالتسامح هنا
       * يسعه، وهو من المستند لا من المحرّك.
       */
      near(p.overPaxShare, 11954.56 + 11018.99, 0.5);
      near(p.adjustedProfit, 482038.93 + 11018.99, 0.5);
      /*
       * وتسوية صفاجا تُطابق الآن بعد نمذجة Over Pax صفاجا (٤٬٩٨١.٠٥).
       * كانت تُخالف بمقدار ١٬٦٦٠.١٨ = ٣٣.٣٣٪ منها، وبقيت غير منمذَجةٍ حتّى
       * وصل مستند ١–١٥ أغسطس فأظهر الآليّة لا النتيجة وحدها.
       */
      near(a.safagaAdjust, -24322.92, 0.35);
      near(a.safagaOverPaxShare, 1660.18, 0.02);
      near(p.safagaOverPaxShare, -1660.18, 0.02);
    });

    /*
     * ٢٨ فبراير – ١٣ مارس ٢٠٢٦ · أمل ٦ و٧ و٨ → ٤٦٬٣٣٩.٧٨ كلّه في ضبا.
     * تُطابق بالسنت — ولا شيء فيها يحتاج تسامحاً.
     */
    it('٢٨ فبراير – ١٣ مارس · بالسنت — ووجهةٌ معكوسة', () => {
      const r = period({
        days: 14,
        amal: { duba: 342146.37, coll: 0, op: 46339.78, fuel: 0, voy: 4 },
        pos: { duba: 512367.37, coll: -19534.05, fuel: 102682.63, voy: 6 },
      });
      const a = of(r, 'amal'), p = of(r, 'poseidon');
      /*
       * أوضح حالات الفرق: ٤٦٬٣٣٩.٧٨ كلّها نشأت على أمل، فالوجهتان تتبادلان
       * تماماً. المستند يعطي أمل ٤٥٨٬١٥١.٦٠ وبوسيدون ٤٤٢٬٧٠١.٩٢، والنظام
       * يعكسهما — و١٥٬٤٤٩.٦٨ تنتقل من أمل إلى بوسيدون.
       */
      near(p.overPaxShare, 30894.73, 0.02);
      near(a.overPaxShare, 15445.05, 0.02);
      near(p.adjustedProfit, 458151.60, 0.02);
      near(a.adjustedProfit, 442701.92, 0.02);
      near(r.fuelShare, 51341.32);
      // والمستند يوزّع أمل ٢٠٨٬٠٤٣ وبوسيدون ٢١٢٬١٢٧
      expect(a.dividendPayable).toBe(192593);
      expect(p.dividendPayable).toBe(227577);
      near(a.remainingAtDuba, 0.58, 0.02);
      near(p.remainingAtDuba, 0.31, 0.02);
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
        pos: { duba: 876600.95, coll: 85097.59, op: 16485.34, opSaf: 1226.42,
          fuel: 137030.47, voy: 5 },
      });
      const a = of(r, 'amal'), p = of(r, 'poseidon');
      // نشأ على بوسيدون، فالقاعدة الثابتة تُوافق المستند هنا ولا تخالفه
      near(p.overPaxShare, 10990.78, 0.02);
      near(a.overPaxShare, 5494.56, 0.02);
      near(a.adjustedProfit, 758946.61, 0.02);
      near(p.adjustedProfit, 764442.83, 0.02);
      near(r.fuelShare, 221122.32, 0.02);
      // ٤٠٨.٧٧ = ٣٣.٣٣٪ من ١٬٢٢٦.٤٢ المحصَّلة في صفاجا — منمذَجةٌ الآن
      near(a.safagaAdjust, -16710.60, 0.02);
      near(a.safagaOverPaxShare, 408.77, 0.02);
    });

    /*
     * ١ – ١٥ أغسطس ٢٠٢٦ — المستند الذي حسم قاعدة Over Pax صفاجا.
     *
     * «MV Posiedon Voy.#75 · ١٠٩ راكباً · ٥٬٩٣٦.٩٣ تُقسم ٦٦.٦٧٪ لبدوي
     *  و٣٣.٣٣٪ للاتحاد» — ومنها Saf ٤٬٩٥٥.٦٠ و Dub ٩٨١.٣٣.
     *
     * والمستند يُثبت أنّ جزء ضبا وحده يدخل الوعاء برقمه: مجموع نقده المكتوب
     * ١٬٥٢٤٬٣٦١.١٥ يزيد عن جمع العمودين ١٬٥٢٣٬٣٧٩.٨٢ بـ ٩٨١.٣٣ بالضبط.
     *
     * ويُثبت آليّة جزء صفاجا في سطر نقد صفاجا:
     *   بوسيدون ٢٢٠٬٨٠٩.٣٥ − ٣٤٬٨٢٦.٣٨ + ٤٬٩٥٥.٦٠ = ١٩٠٬٩٣٨.٥٧
     *   أمل     ١٥٤٬٤٦٠.٠٠ + ٣٤٬٨٢٦.٣٨            = ١٨٩٬٢٨٦.٣٨
     */
    it('١ – ١٥ أغسطس · Over Pax مقسومٌ بين ضبا وصفاجا', () => {
      const r = period({
        days: 15, fee: 500,
        amal: { duba: 637840.48, coll: 154460.00, fuel: 315841.35, voy: 5, sd: 503230 },
        pos: { duba: 885539.33, coll: 220809.35, op: 981.33, opSaf: 4955.60,
          fuel: 0, voy: 5, sd: 596440 },
      });
      const a = of(r, 'amal'), p = of(r, 'poseidon');

      // جزء ضبا وحده في الوعاء
      near(r.totalOverPax, 981.33, 0.02);
      near(r.totalOverPaxSafaga, 4955.60, 0.02);
      near(p.overPaxShare, 654.25, 0.02);
      near(a.overPaxShare, 327.08, 0.02);
      near(a.adjustedProfit, 762016.99, 0.02);
      near(p.adjustedProfit, 762344.16, 0.02);

      // الخصومات الثلاثة كما في المستند
      near(r.rentShare, 202500.00);
      near(r.fuelShare, 157920.68, 0.02);
      near(r.feeShare, 38239.28, 0.02);   // ١٬٠٩٩٬٦٧٠ × ٦.٥٪ + ١٠ × ٥٠٠ ÷ ٢

      // تسوية صفاجا تجمع البندين كما يطويهما المستند في سطرٍ واحد
      near(a.safagaOverPaxShare, 1651.70, 0.02);
      near(p.safagaOverPaxShare, -1651.70, 0.02);
      near(a.safagaAdjust, 34826.38, 0.02);
      near(p.safagaAdjust, -34826.38, 0.02);

      // والتوزيع — المستند يكتب ٣٩٨٬١٨٢.٧٢ و٣٢٨٬٨٥٧.٧٣ ويُبقي الكسر رصيداً
      expect(a.dividendPayable).toBe(398183);
      expect(p.dividendPayable).toBe(328857);
      near(a.dividend, 398183.41, 0.05);
      near(p.dividend, 328857.84, 0.05);
    });

    /*
     * سطر التحويل البنكيّ — وهو ما يُصادَق عليه ويُجمَّد.
     *
     * المستند يبنيه: التوزيع + إيجاره + **حصّة** العمولة + Fuel Supply.
     * وحصّة العمولة مكرَّرةٌ في العمودين في المستندات الأربعة، فهي الحصّة
     * قطعاً لا عمولة المركب.
     *
     * وسطر `Fuel Supply` صفرٌ في هذه الفترة رغم أنّ بنكر أمل ٣١٥٬٨٤١.٣٥
     * يُخصم مناصفةً — وهو الدليل على أنّهما بندان لا واحد.
     */
    it('١ – ١٥ أغسطس · التحويل البنكيّ كما يكتبه المستند', () => {
      const r = period({
        days: 15, fee: 500,
        amal: { duba: 637840.48, coll: 154460.00, fuel: 315841.35, voy: 5, sd: 503230, fs: 0 },
        pos: { duba: 885539.33, coll: 220809.35, op: 981.33, opSaf: 4955.60,
          fuel: 0, voy: 5, sd: 596440, fs: 0 },
      });
      const a = of(r, 'amal'), p = of(r, 'poseidon');

      /*
       * والتسامح دون الدولار لا لضعفٍ في المعادلة بل لاختلاف تدوير:
       * محرّكنا يُنزل التوزيع إلى الدولار الصحيح ويُبقي كسره رصيداً، وهذا
       * المستند يُبقي السنتات ويكتب رصيداً آخر (٠.٦٩ و٠.١١). فالفرق كسرٌ
       * في سطر التوزيع ينتقل كما هو إلى التحويل.
       */
      near(a.transferToAccount, 631422.00, 0.8);   // Amount to be transferred
      near(p.transferToAccount, 577097.01, 0.8);
      near(r.partnerTransfer.ittihad, 631422.00, 0.8);
      near(r.partnerTransfer.badawi, 577097.01, 0.8);

      // ولا يُردّ البنكر في التحويل — بخلاف «المستحقّ لحساب المركب»
      near(a.dueToAccount - a.transferToAccount, 315841.35 - 3029.33, 0.35);
    });

    it('Fuel Supply يُضاف للتحويل ولا يمسّ التوزيع', () => {
      const base = {
        days: 15, fee: 500,
        amal: { duba: 637840.48, coll: 154460.00, fuel: 315841.35, voy: 5, sd: 503230 },
        pos: { duba: 885539.33, coll: 220809.35, op: 981.33, opSaf: 4955.60,
          fuel: 0, voy: 5, sd: 596440 },
      };
      const without = period(base);
      const withFs = period({ ...base, amal: { ...base.amal, fs: 125658.05 } });
      const a0 = of(without, 'amal'), a1 = of(withFs, 'amal');
      expect(a1.dividendPayable).toBe(a0.dividendPayable);      // التوزيع لا يتغيّر
      near(a1.transferToAccount - a0.transferToAccount, 125658.05, 0.02);
      near(withFs.totalFuelSupply, 125658.05);
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

    it('التحويل يُجمَع للشريكين: دليلة مع الاتحاد لا مع بدوي', () => {
      const r = calculateDistribution({
        days: 14, commissionRate: 6.5, perVoyageFee: 500,
        vessels: [
          vessel({ key: 'amal', name: 'أمل', voyages: 3, dailyRate: 13000, cashDuba: 200000 }),
          vessel({ key: 'poseidon', name: 'بوسيدون', voyages: 3, dailyRate: 14000, cashDuba: 300000 }),
          vessel({ key: 'daleela', name: 'دليلة', voyages: 2, dailyRate: 9000, cashDuba: 120000 }),
        ],
      });
      const t = (k: string) => r.vessels.find((v) => v.key === k)!.transferToAccount;
      near(r.partnerTransfer.badawi, t('poseidon'), 0.02);
      near(r.partnerTransfer.ittihad, t('amal') + t('daleela'), 0.02);
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
    it('Over Pax صفاجا: مجموع التحويلات صفر — لا يُخلق مالٌ ولا يُعدم', () => {
      const r = calculateDistribution({
        days: 14, commissionRate: 6.5, perVoyageFee: 500,
        vessels: [
          vessel({ key: 'amal', name: 'أمل', voyages: 3, dailyRate: 13000,
            cashDuba: 200000, overPaxSafaga: 3000 }),
          vessel({ key: 'poseidon', name: 'بوسيدون', voyages: 3, dailyRate: 14000,
            cashDuba: 300000, overPaxSafaga: 9000 }),
        ],
      });
      const t = r.vessels.reduce((a, v) => a + v.safagaOverPaxShare, 0);
      expect(Math.abs(t)).toBeLessThanOrEqual(0.02);
      // ١٢٬٠٠٠ مجموعاً: بدوي ٨٬٠٠٠.٤٠ وبيده ٩٬٠٠٠ · والاتحاد ٣٬٩٩٩.٦٠ وبيده ٣٬٠٠٠
      near(r.vessels.find((v) => v.key === 'poseidon')!.safagaOverPaxShare, -999.60, 0.02);
      near(r.vessels.find((v) => v.key === 'amal')!.safagaOverPaxShare, 999.60, 0.02);
    });

    it('دليلة شريكاً مع Over Pax صفاجا: لا تسويةَ وتُعلَن', () => {
      const r = calculateDistribution({
        days: 14, commissionRate: 6.5, perVoyageFee: 500,
        vessels: [
          vessel({ key: 'amal', name: 'أمل', voyages: 3, dailyRate: 13000, cashDuba: 200000 }),
          vessel({ key: 'poseidon', name: 'بوسيدون', voyages: 3, dailyRate: 14000,
            cashDuba: 300000, overPaxSafaga: 5000 }),
          vessel({ key: 'daleela', name: 'دليلة', voyages: 2, dailyRate: 9000, cashDuba: 120000 }),
        ],
      });
      for (const v of r.vessels) expect(v.safagaOverPaxShare).toBe(0);
      expect(r.warnings.some((w) => w.includes('صفاجا'))).toBe(true);
    });

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

describe('الطريقة المقترحة — ورقة الزميل', () => {
  const vessel = (o: Partial<VesselInput> & { key: string; name: string }): VesselInput => ({
    voyages: 0, sdBase: 0, sdAdjust: 0, fuel: 0, fuelAdjust: 0,
    cashDuba: 0, netCollected: 0, dailyRate: 0, ...o,
  });
  const near = (got: number, want: number, tol = 0.02) => {
    expect(Math.abs(got - want)).toBeLessThanOrEqual(tol);
  };

  /*
   * ورقة «الأسبوع الرابع من يونيو من يوليو الأوّل ٢٠٢٦»
   * أمل ٥٧–٦١ · بوسيدون ٧٣–٧٧ · خمسة عشر يوماً
   *
   * أرقام الورقة منقولةٌ حرفياً، وصافيا الإيراد مطابقان لعمود «الصافي» في
   * تفصيل الرحلات: بوسيدون ١٬١٠٦٬٣٤٨.٦٨ بالسنت.
   */
  const sheet = () => calculateProposed({
    days: 15, commissionRate: 6.5, perVoyageFee: 500,
    vessels: [
      vessel({ key: 'amal', name: 'أمل', voyages: 5, dailyRate: 13000,
        netRevenue: 476459.13, netCollected: 154460.00, fuel: 315841.35 }),
      vessel({ key: 'poseidon', name: 'بوسيدون', voyages: 5, dailyRate: 14000,
        netRevenue: 1106348.68, netCollected: 220809.35, overPax: 5936.93 }),
    ],
  });
  const of = (r: ProposedResult, k: string) => r.vessels.find((v) => v.key === k)!;

  it('الصافي بعد الخصم = صافي الإيراد − الإيجار', () => {
    const r = sheet();
    near(of(r, 'amal').afterRent, 281459.13);
    near(of(r, 'poseidon').afterRent, 896348.68);
  });

  it('توزيع النسب = ٥٨٨٬٩٠٣.٩١ للاثنين', () => {
    const r = sheet();
    near(r.totalAfterRent, 1177807.81);
    near(r.pooled, 588903.91);
  });

  it('حصّة Over Pax بالقاعدة الثابتة نفسها', () => {
    const r = sheet();
    near(of(r, 'poseidon').overPaxShare, 3958.15);   // ٦٦.٦٧٪ لبدوي
    near(of(r, 'amal').overPaxShare, 1978.78);       // ٣٣.٣٣٪ للاتحاد
  });

  it('الرصيد طرف البسّام: أمل ٤٣٦٬٤٢٢.٦٩ · بوسيدون ٣٧٢٬٠٥٢.٧١', () => {
    const r = sheet();
    near(of(r, 'amal').balanceAtBassam, 436422.69);
    near(of(r, 'poseidon').balanceAtBassam, 372052.71);
  });

  /*
   * ── حيث تفارق ورقةُ الزميل مستندَه ──
   *
   * ورقته تكتب لأمل ٩٤٧٬٢٦٤.٠٣ لأنّها تردّ البنكر ٣١٥٬٨٤١.٣٥ في السطر
   * الأخير. والمستند الرسميّ يكتب `Amount to be transferred` = ٦٣١٬٤٢٢.٠٠،
   * و`Fuel Supply` فيه صفر.
   *
   * والفارق بينهما **هو البنكر بعينه** — وردُّه خطأٌ مضاعف: صافي الإيراد
   * يطرحه أصلاً في `المصاريف` (`man = … + bnk + …`). فالمحرّك يتبع المستند.
   */
  it('التحويل: أمل ٦٣١٬٤٢٢.٦٨ · بوسيدون ٥٧٧٬٠٩٧.١١ — ولا يُردّ البنكر', () => {
    const r = sheet();
    const a = of(r, 'amal'), p = of(r, 'poseidon');
    near(a.total, 947264.03 - 315841.35, 0.02);   // ٦٣١٬٤٢٢.٦٨
    near(p.total, 582052.71);
    near(r.grandTotal, 1529316.74 - 315841.35, 0.02);
    near(r.partnerTransfer.badawi, p.total, 0.02);
    near(r.partnerTransfer.ittihad, a.total, 0.02);
  });

  /*
   * والفرق عن سلسلة المستند في الفترة نفسها ثلاثة بنودٍ لا واحد:
   *   عمولة التوكيل · كسر التدوير · والبنكر الذي تردّه تلك ولا تردّه هذه.
   */
  it('الفرق عن سلسلة المستند: العمولة والتدوير والبنكر', () => {
    const r = sheet();
    const a = of(r, 'amal').total, p = of(r, 'poseidon').total;
    near(a + p, r.grandTotal);
    // سلسلة المستند على الفترة نفسها: ٩٤٤٬٢٣٤.٣٠ و٥٨٥٬٠٨١.٦٠
    near(a - 944234.30, 3029.73 - 315841.35, 0.02);
    near(p - 585081.60, -3028.89, 0.02);
  });

  /*
   * ── البنكر لا يُردّ · و`Fuel Supply` يُردّ ──
   *
   * صافي الإيراد **يطرح البنكر أصلاً**: الدفتر يجمعه في `المصاريف`
   * (`man = … + bnk + …`). فردُّه في السطر الأخير يحسبه مرّتين.
   *
   * وورقة الزميل كانت تردّه فتُعطي أمل ٩٤٧٬٢٦٤.٠٣، والمستند الرسميّ يكتب
   * ٦٣١٬٤٢٢.٠٠ — والفارق ٣١٥٬٨٤١.٣٥ هو البنكر بعينه. فالمستند هو المرجع.
   */
  it('البنكر لا يُردّ — والمردود Fuel Supply وحده', () => {
    const r = sheet();
    // بنكر أمل ٣١٥٬٨٤١.٣٥ في المدخلات، ولا أثر له في التحويل
    near(of(r, 'amal').fuelSupply, 0);
    near(of(r, 'amal').total - of(r, 'amal').balanceAtBassam, 195000);
  });

  it('Fuel Supply يُضاف للتحويل ولا يمسّ الرصيد طرف البسّام', () => {
    const r = calculateProposed({
      days: 15, commissionRate: 6.5, perVoyageFee: 500,
      vessels: [
        vessel({ key: 'amal', name: 'أمل', voyages: 5, dailyRate: 13000,
          netRevenue: 476459.13, netCollected: 154460.00,
          fuel: 305214.16, fuelSupply: 125658.05 }),
        vessel({ key: 'poseidon', name: 'بوسيدون', voyages: 5, dailyRate: 14000,
          netRevenue: 1106348.68, netCollected: 220809.35, fuel: 137030.47 }),
      ],
    });
    const a = of(r, 'amal');
    near(a.fuelSupply, 125658.05);
    // ٣٠٥٬٢١٤.١٦ بنكراً لا يظهر · و١٢٥٬٦٥٨.٠٥ وحدها تُضاف
    near(a.total - a.balanceAtBassam, 195000 + 125658.05);
  });

  it('التحويل يُجمَع للشريكين: دليلة مع الاتحاد', () => {
    const r = calculateProposed({
      days: 14, commissionRate: 6.5, perVoyageFee: 500,
      vessels: [
        vessel({ key: 'amal', name: 'أمل', voyages: 3, dailyRate: 13000, netRevenue: 300000 }),
        vessel({ key: 'poseidon', name: 'بوسيدون', voyages: 3, dailyRate: 14000, netRevenue: 500000 }),
        vessel({ key: 'daleela', name: 'دليلة', voyages: 2, dailyRate: 9000, netRevenue: 180000 }),
      ],
    });
    const t = (k: string) => of(r, k).total;
    near(r.partnerTransfer.badawi, t('poseidon'), 0.02);
    near(r.partnerTransfer.ittihad, t('amal') + t('daleela'), 0.02);
    near(r.partnerTransfer.badawi + r.partnerTransfer.ittihad, r.grandTotal, 0.02);
  });

  /*
   * صافي الإيراد ليس عموداً محفوظاً بل يُجمع من تفصيل الرحلات. وغيابه لا
   * يُعوَّض بصفر: الصفر يُنتج رقماً يبدو سليماً وهو باطل.
   */
  it('غياب صافي الإيراد يُعلَن ولا يُحسب بأصفار', () => {
    const r = calculateProposed({
      days: 15, commissionRate: 6.5, perVoyageFee: 500,
      vessels: [
        vessel({ key: 'amal', name: 'أمل', voyages: 5, dailyRate: 13000, netRevenue: 476459.13 }),
        vessel({ key: 'poseidon', name: 'بوسيدون', voyages: 5, dailyRate: 14000 }),
      ],
    });
    expect(r.available).toBe(false);
    expect(r.reason).toContain('بوسيدون');
    expect(r.vessels).toHaveLength(0);
  });

  /*
   * ١ – ١٥ أغسطس ٢٠٢٦ بمدخلاته الصحيحة — Over Pax مفصولاً بين ضبا وصفاجا.
   *
   * وهنا تلتقي الطريقة المقترحة بالمستند في سطرين لا في واحد:
   *
   *   بوسيدون ٥٧٧٬٠٩٧.١١  ←  `Amount to be transferred` ٥٧٧٬٠٩٧.٠٠
   *   المجموع ١٬٥٢٤٬٣٦١.١٥ ←  `Cash available at El Bassam` ١٬٥٢٤٬٣٦١.١٥
   *
   * ولا يستقيم ذلك إلا بطرح نقد صفاجا **كاملاً** — التحصيل وما حُصّل فيه من
   * Over Pax معاً — وقسمة حصّة **المجموع** لا جزء ضبا وحده.
   */
  it('١ – ١٥ أغسطس · نقد صفاجا يشمل Over Pax المحصَّل فيه', () => {
    const r = calculateProposed({
      days: 15, commissionRate: 6.5, perVoyageFee: 500,
      vessels: [
        vessel({ key: 'amal', name: 'أمل', voyages: 5, dailyRate: 13000, sdBase: 503230,
          netRevenue: 476459.13, netCollected: 154460.00, fuel: 315841.35 }),
        vessel({ key: 'poseidon', name: 'بوسيدون', voyages: 5, dailyRate: 14000, sdBase: 596440,
          netRevenue: 1106348.68, netCollected: 220809.35,
          overPax: 981.33, overPaxSafaga: 4955.60 }),
      ],
    });
    const a = of(r, 'amal'), p = of(r, 'poseidon');

    // نقد صفاجا كاملاً
    near(p.safaga, 225764.95);          // ٢٢٠٬٨٠٩.٣٥ + ٤٬٩٥٥.٦٠
    near(p.safagaOverPax, 4955.60);
    near(a.safaga, 154460.00);
    near(a.safagaOverPax, 0);

    // وحصّة المجموع لا جزء ضبا
    near(p.overPaxShare, 3958.15);      // ٦٦.٦٧٪ × ٥٬٩٣٦.٩٣
    near(a.overPaxShare, 1978.78);

    near(p.balanceAtBassam, 367097.11);
    near(a.balanceAtBassam, 436422.68);

    // وسطرا المستند
    near(p.total, 577097.00, 0.15);     // Amount to be transferred
    /*
     * وورقة الزميل تكتب ٩٤٧٬٢٦٤.٠٣ لأنّها تردّ البنكر ٣١٥٬٨٤١.٣٥.
     * والمستند الرسميّ يكتب ٦٣١٬٤٢٢.٠٠ — والمحرّك يتبع المستند.
     */
    near(a.total, 947264.03 - 315841.35, 0.02);
    // والمجموع يُنقص البنكر كذلك — والمستند يكتبه في `Cash at El Bassam` مع البنكر
    near(r.grandTotal, 1524361.15 - 315841.35, 0.02);
  });

  /*
   * والجسر بين الطريقتين يبقى مغلقاً بعد نمذجة صفاجا:
   *
   *   المقترحة − المعتمدة = (حصّة العمولة − عمولة المركب) + كسر التدوير
   *
   * والحدّ الثالث — فرق الخزينة — صفرٌ ما دام الدفتر متّسقاً. ولو كسرت
   * إحدى الطريقتين معالجة Over Pax صفاجا لظهر فيه رقمٌ فوراً.
   */
  it('الجسر إلى المعتمدة يبقى مغلقاً: العمولة والتدوير لا غير', () => {
    const inp = {
      days: 15, commissionRate: 6.5, perVoyageFee: 500,
      vessels: [
        vessel({ key: 'amal', name: 'أمل', voyages: 5, dailyRate: 13000, sdBase: 503230,
          netRevenue: 476459.13, cashDuba: 637840.48, netCollected: 154460.00, fuel: 315841.35 }),
        vessel({ key: 'poseidon', name: 'بوسيدون', voyages: 5, dailyRate: 14000, sdBase: 596440,
          netRevenue: 1106348.68, cashDuba: 885539.33, netCollected: 220809.35,
          overPax: 981.33, overPaxSafaga: 4955.60 }),
      ],
    };
    const d = calculateDistribution(inp);
    const pr = calculateProposed(inp);
    for (const v of pr.vessels) {
      const av = d.vessels.find((x) => x.key === v.key)!;
      const feeGap = d.feeShare - av.fee;
      // وسلسلة المستند تردّ البنكر في `dueToAccount` وهذه لا تردّه
      const residual = v.total - (av.dueToAccount - av.fuel + feeGap + av.remainingAtDuba);
      expect(Math.abs(residual)).toBeLessThanOrEqual(0.02);
    }
  });

  it('المركب الراسي لا يدخل القسمة', () => {
    const r = calculateProposed({
      days: 15, commissionRate: 6.5, perVoyageFee: 500,
      vessels: [
        vessel({ key: 'amal', name: 'أمل', voyages: 5, dailyRate: 13000, netRevenue: 400000 }),
        vessel({ key: 'poseidon', name: 'بوسيدون', voyages: 5, dailyRate: 14000, netRevenue: 600000 }),
        vessel({ key: 'daleela', name: 'دليلة', dailyRate: 12000 }),
      ],
    });
    expect(r.available).toBe(true);
    expect(r.partners).toBe(2);
  });
});
