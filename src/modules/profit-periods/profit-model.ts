/**
 * محرّك توزيع الأرباح — معادلة المستند المعتمد.
 *
 * ── لماذا وُجد هذا الملفّ ──
 * كانت المعادلة مكتوبةً مرّتين: مرّةً في الخدمة ومرّةً في صفحة الفرونت.
 * نسختان تنحرفان مع أوّل تعديل، ولا تُختبر إحداهما. فنُقلت إلى هنا: دالّةٌ
 * خالصة بلا Nest ولا TypeORM ولا شبكة، يستوردها الباك وتُرآى في الفرونت،
 * وتحرسها اختباراتٌ تُعيد إنتاج المستندات الورقيّة رقماً رقماً.
 *
 * ── المعادلة ──
 * المستند لا يبدأ من الإيراد بل من **النقد**. هذا هو الفرق الجوهريّ:
 * الإيراد ليس مالاً وصل، وبينه وبين الخزينة مصروفاتُ الرحلة كلّها.
 *
 *   الأساس المشترك = مجموع نقد ضبا ÷ عدد الشركاء
 *   + حصّة Over Pax (تخصّ كلّ شريك وحده)
 *   = معدّل الربح
 *   − حصّة الإيجار = مجموع الإيجارات ÷ عدد الشركاء
 *   − حصّة الوقود  = مجموع الوقود ÷ عدد الشركاء
 *   − حصّة العمولة = مجموع (أساس×٦.٥٪ + ٥٠٠×رحلات) ÷ عدد الشركاء
 *   ± تسوية صفاجا = متوسّط التحصيل − تحصيل المركب نفسه
 *   = التوزيع المقترح
 *
 * كلّ عبءٍ يُقسم مناصفةً **قبل** الطرح، فلا يفترق الشريكان إلا في بندين:
 * Over Pax وتسوية صفاجا.
 *
 * ── التدوير إلى الدولار الصحيح ──
 * المستند يُنزل التوزيع إلى الدولار الصحيح ويُبقي الكسر رصيداً في ضبا، ويكتبه
 * صراحةً في سطر «Remaining Balance at Duba». في مستند مارس ٢٠٢٦: التوزيع
 * المحسوب ٧٥٬٠٢٧.٦٥ فكُتب ٧٥٬٠٢٧ والمتبقّي ٠.٦٥. ولولا هذا لبدا الفارق خطأً
 * وهو سطرٌ في الورقة.
 *
 * ── ما ثبت ──
 * أُعيدت أربع فتراتٍ من مدخلاتها وحدها: مارس ٢٠٢٦ بالسنت، ويوليو بفارقٍ دون
 * خمسة سنتات. الاختبارات تُثبّت ذلك.
 *
 * ── أساس العمولة ──
 * ليس الإيراد ولا صافيه، بل **شاحنات رحلة الذهاب وحدها** — الحقل `trE` في
 * دفتر الرحلات. طوبق على ستّ حالاتٍ فأصاب خمساً بصفر فرق. والسادسة زادت
 * بمقدار تحصيل صفاجا بالضبط، وهي تسويةٌ بشريّة تُسجَّل في حقل التعديل.
 */

/** مركبٌ واحد داخل الفترة. كلّ حقلٍ هنا إمّا من دفتر الرحلات أو من الخزينة. */
export interface VesselInput {
  key: string;
  name: string;
  /** عدد الرحلات — من دفتر الرحلات */
  voyages: number;
  /** أساس العمولة: مجموع `trE` — شاحنات الذهاب */
  sdBase: number;
  /** تعديلٌ يدويّ على الأساس. يستوجب سبباً مكتوباً. */
  sdAdjust: number;
  /** الوقود: مجموع `bnk` */
  fuel: number;
  /** تعديلٌ يدويّ على الوقود. يستوجب سبباً مكتوباً. */
  fuelAdjust: number;
  /** النقد المتاح في ضبا — رصيد خزينةٍ فعليّ، لا يُشتقّ من الدفتر */
  cashDuba: number;
  /** صافي التحصيل في صفاجا — فعليّ كذلك */
  netCollected: number;
  /** السعر اليوميّ للإيجار */
  dailyRate: number;
  /** الإيراد — للعرض والمراجعة فقط، لا يدخل أيّ حساب */
  revenue?: number;
  /**
   * Over Pax **كما نشأ على هذا المركب** — لا كما آل إلى الشريك.
   *
   * إيراد الركّاب الزائدين عن المئة في الرحلة الواحدة يُفرَد عن إيراد الرحلة
   * ويُقسم بقاعدةٍ أخرى ثابتة: ٦٦.٦٧٪ لبدوي و٣٣.٣٣٪ للاتحاد، مهما كان منشؤه.
   * فما نشأ على مركبٍ لا يذهب إليه كلّه، والقسمة تجري في المحرّك.
   *
   * ── ويُدخَل **جزء ضبا** منه وحده ──
   * Over Pax قد يُحصَّل في مكانين. مستند ٢٠ يونيو ٢٠٢٦: مجموعه ١٧٬٧١١.٧٦، منه
   * ١٦٬٤٨٥.٣٤ في ضبا و١٬٢٢٦.٤٢ في صفاجا — والداخل في القسمة هو **جزء ضبا**
   * وحده. أثبته المستند برقمه: مجموع نقده المكتوب يزيد عن جمع عمودَي المركبين
   * بـ ١٦٬٤٨٥.٣٤ بالضبط، لا بـ ١٧٬٧١١.٧٦.
   *
   * وكذلك فبراير ١٤–٢٧: ٣٩٬٤٣٩.٨٨ مجموعاً، والداخل ٣٤٬٤٥٨.٨٣ — والفارق
   * ٤٬٩٨١.٠٥ هو ما حُصّل في صفاجا.
   */
  overPax?: number;
  /**
   * Over Pax **المحصَّل في صفاجا** — لا يدخل وعاء ضبا.
   *
   * ── القاعدة، ومستندٌ يُظهر آليّتها لا نتيجتها فقط ──
   * ما حُصّل في صفاجا **يبقى عند حائزه**، ونصيب الشريك الآخر يُحوَّل إليه ضمن
   * تسوية صفاجا. مستند ١–١٥ أغسطس ٢٠٢٦ يكتب الطرفين صراحةً:
   *
   *   نقد بوسيدون في صفاجا = ٢٢٠٬٨٠٩.٣٥ − ٣٤٬٨٢٦.٣٨ + ٤٬٩٥٥.٦٠ = ١٩٠٬٩٣٨.٥٧
   *   نقد أمل في صفاجا     = ١٥٤٬٤٦٠.٠٠ + ٣٤٬٨٢٦.٣٨            = ١٨٩٬٢٨٦.٣٨
   *
   * فالمبلغ ليس داخل «التحصيل»، بل يُضاف لحائزه ويُقتطع منه نصيب الآخر.
   *
   * ── وثلاثة مستنداتٍ تُثبّت المقدار ──
   *   فبراير ١٤–٢٧    ١٬٦٦٠.١٨ = ٣٣.٣٣٪ × ٤٬٩٨١.٠٥
   *   يونيو ٢٠–٣ يوليو   ٤٠٨.٧٧ = ٣٣.٣٣٪ × ١٬٢٢٦.٤٢
   *   أغسطس ١–١٥      ١٬٦٥١.٧٠ = ٣٣.٣٣٪ × ٤٬٩٥٥.٦٠
   *
   * وكلّها نشأت على بوسيدون. والقاعدة الثابتة (٦٦.٦٧٪ لبدوي دائماً) تجعل
   * الاتّجاه مستقلّاً عن المنشأ، فتنطبق الصيغة نفسها لو نشأ على أمل.
   */
  overPaxSafaga?: number;
  /**
   * تسوية إيقاف المركب — بندٌ في المستند لم يُرَ إلا صفراً.
   *
   * يُخزَّن ويُنبَّه عليه ولا يدخل الحساب: موضعه في السلسلة غير معروف، وإدخاله
   * بالتخمين يُغيّر توزيعاً حقيقياً بناءً على ظنّ.
   */
  offHireSettlement?: number;
  /** سيولة الدفتر `liq` — اقتراحٌ لنقد ضبا، للمقارنة لا للحساب */
  liquidity?: number;
  /**
   * صافي الإيراد — `الإيراد − العمولة − المصاريف`، مجموع عمود «الصافي» في
   * تفصيل الرحلات. لا تستعمله المعادلة المعتمدة، وعليه تقوم **الطريقة
   * المقترحة** وحدها. و`undefined` تعني «لم تُلتقط» لا «صفر».
   */
  netRevenue?: number;
}

export interface ModelInput {
  days: number;
  /** نسبة العمولة، ٦.٥ */
  commissionRate: number;
  /** رسمٌ ثابت لكلّ رحلة، ٥٠٠ */
  perVoyageFee: number;
  vessels: VesselInput[];
}

export interface VesselResult {
  key: string;
  name: string;
  voyages: number;
  revenue: number;
  /** الأساس بعد التعديل */
  sdBase: number;
  sdAdjust: number;
  /** عمولة هذا المركب قبل القسمة */
  fee: number;
  /** الوقود بعد التعديل */
  fuel: number;
  fuelAdjust: number;
  /** الإيجار الفعليّ لهذا المركب: أيام × سعر يوميّ */
  rent: number;
  cashDuba: number;
  netCollected: number;
  /** Over Pax كما نشأ على هذا المركب */
  overPax: number;
  /** نصيب هذا الشريك من Over Pax بعد قاعدة الثلثين */
  overPaxShare: number;
  /** Over Pax المحصَّل في صفاجا على هذا المركب — كما أُدخل */
  overPaxSafaga: number;
  /**
   * ما يُحوَّل إلى هذا الشريك من Over Pax صفاجا — داخلٌ في `safagaAdjust`.
   * يُفرَد للعرض والمراجعة، والمستند يطويه في سطر التسوية الواحد.
   */
  safagaOverPaxShare: number;
  /** معدّل الربح = الأساس المشترك + نصيب Over Pax */
  adjustedProfit: number;
  /** تسوية صفاجا: (متوسّط التحصيل − تحصيله) + نصيبه من Over Pax صفاجا */
  safagaAdjust: number;
  /** التوزيع المحسوب بالسنت */
  dividend: number;
  /** التوزيع كما يكتبه المستند — بالدولار الصحيح */
  dividendPayable: number;
  /** المخصوم من ضبا = حصص الإيجار والوقود والعمولة + التوزيع المكتوب */
  deductedFromDuba: number;
  /** المتبقّي في ضبا — كسرُ التدوير، دون الدولار دائماً */
  remainingAtDuba: number;
  /** المستحقّ لحساب المركب = التوزيع + إيجاره ووقوده وعمولته الفعليّة */
  dueToAccount: number;

  /*
   * ── أثر الشراكة ──
   *
   * سؤالُ الإدارة: ماذا كان يجني المركب لو عمل وحده؟
   *
   * منفرداً  = نقده في ضبا + تحصيله في صفاجا + Over Pax الخاصّ به
   *            − إيجاره − وقوده − عمولته، كلٌّ بمقداره هو لا بحصّةٍ مقسومة
   *
   * شراكةً   = التوزيع الذي ناله + تحصيله في صفاجا
   *            (وتسوية صفاجا داخل التوزيع أصلاً، فلا تُحسب مرّتين)
   *
   * والفرق **صفريّ المجموع**: ما تكسبه سفينةٌ من الشراكة تخسره الأخرى بالضبط.
   * فالرقم لا يقول «الشراكة رابحة» بل يقول **من يدعم من، وبكم**.
   */
  /** الحصيلة لو عمل المركب وحده */
  standalone: number;
  /** الحصيلة في الشراكة */
  partnered: number;
  /** شراكةً − منفرداً · موجبٌ يعني أنّ الشراكة تدعمه */
  partnershipGain: number;
  /** فرق سيولة الدفتر عن نقد ضبا المُدخَل — للمراجعة لا للحساب */
  liquidityGap: number | null;
}

export interface ModelResult {
  days: number;
  partners: number;
  /** الأساس المشترك = مجموع نقد ضبا ÷ عدد الشركاء */
  baseShare: number;
  totalCashDuba: number;
  totalOverPax: number;
  /** مجموع Over Pax المحصَّل في صفاجا — لا يدخل وعاء ضبا */
  totalOverPaxSafaga: number;
  rentShare: number;
  fuelShare: number;
  feeShare: number;
  totalRent: number;
  totalFuel: number;
  totalFee: number;
  totalRevenue: number;
  avgNetCollected: number;
  vessels: VesselResult[];
  /** مدخلاتٌ ناقصة تمنع الاعتماد على النتيجة */
  missing: string[];
  /** ملاحظاتٌ لا تمنع الحساب لكنّها تستوجب النظر */
  warnings: string[];
}

const n = (v: unknown): number => {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};
const r2 = (v: number): number => Math.round(v * 100) / 100;

/** عدد أيام الفترة — الطرفان محسوبان. ١٨ إلى ٣١ يوليو = ١٤ يوماً. */
export function daysBetween(from: string, to: string): number {
  if (!from || !to) return 0;
  const a = new Date(from).getTime();
  const b = new Date(to).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.max(0, Math.round((b - a) / 86_400_000) + 1);
}

/**
 * الشريك يُحتسب إن كان له نشاطٌ في الفترة.
 *
 * القسمة على «عدد الشركاء» هي عصب المعادلة، فمن يدخل القسمة يُغيّر كلّ رقم.
 * مركبٌ راسٍ بلا رحلاتٍ ولا نقدٍ ولا تحصيلٍ ليس شريكاً في هذه الفترة، وإدخاله
 * يقسم الأعباء على ثلاثةٍ بدل اثنين فيرفع نصيب الجميع بلا وجه حقّ. ولهذا
 * تخرج دليلة من القسمة في المستندات الثلاثة: صفرٌ في كلّ عمود.
 */
function isActive(v: VesselInput): boolean {
  return n(v.voyages) > 0 || n(v.cashDuba) !== 0 || n(v.netCollected) !== 0;
}

/**
 * قسمة Over Pax بين الشريكين.
 *
 * ── القاعدة، بقرار المالك ──
 * **٦٦.٦٧٪ لبدوي و٣٣.٣٣٪ للاتحاد — دائماً.** لا تنقلب النسبتان بمنشأ الرحلة،
 * وتُطبَّقان على مبلغ Over Pax وحده لا على غيره من بنود التوزيع.
 *
 * وبدوي هو بوسيدون، والاتحاد أمل ودليلة.
 *
 * ── وهنا يفترق النظام عن ثلاثة مستندات، عن عمد ──
 * ثلاثة مستنداتٍ نشأ فيها Over Pax على أمل تحسبها بالمنشأ فتعكس النسبتين:
 *
 *   فبراير ٢٠٢٦ · أمل ٢         «٦٦.٦٧٪ للاتحاد و٣٣.٣٣٪ لبدوي»
 *   فبراير ٢٠٢٦ · أمل ٣ و٥     «٦٦.٦٧٪ للاتحاد و٣٣.٣٣٪ لبدوي»
 *   مارس ٢٠٢٦ · أمل ٦ و٧ و٨   «٦٦.٦٧٪ للاتحاد و٣٣.٣٣٪ لبدوي»
 *
 * وحسابها يوافق نصّها: نقد أمل في ٢٨ فبراير – ١٣ مارس أقلّ بمئةٍ وسبعين ألفاً
 * ومعدّل ربحه أعلى، ولا يكون ذلك إلا بأخذه الحصّة الكبرى.
 *
 * وعُرض هذا التعارض على المالك بأرقامه، فأكّد القاعدة الثابتة. فالنظام يتبعها،
 * ويخالف تلك المستندات الثلاثة بمقدار ٣٣.٣٤٪ من Over Pax الناشئ على أمل —
 * وأثرها في ٢٨ فبراير – ١٣ مارس وحدها ١٥٬٤٤٩.٦٨ تنتقل من أمل إلى بوسيدون.
 *
 * والمستندات الثلاثة نفسها **لم تُصحَّح**؛ ما وُزِّع بها بقي كما وُزِّع، وهذه
 * القاعدة تسري على ما يُحسب بالنظام. والاختبارات تُبقي أرقام المستندات ظاهرةً
 * بجوار أرقام النظام حتّى يبقى الفرق موثَّقاً لا منسيّاً.
 *
 * ── ولماذا ٠.٦٦٦٧ لا ثلثان ──
 * المستند يكتب النسبة عدداً عشرياً: «66.67%» و«33.33%». والفرق بينهما وبين
 * الثلثين ٠.٢٢ دولار في مستند مارس — صغيرٌ لكنّه يكسر التطابق. والمرجع هو
 * ما كُتب لا ما يُشتقّ، فالنسبتان كما هما، ومجموعهما واحدٌ صحيح.
 */
const OVER_PAX_BADAWI = 0.6667;
const OVER_PAX_ETEHAD = 0.3333;
function splitOverPax(active: VesselInput[]): { share: Record<string, number>; unproven: boolean } {
  const raw: Record<string, number> = {};
  for (const v of active) raw[v.key] = n(v.overPax);

  const share: Record<string, number> = {};
  for (const v of active) share[v.key] = 0;

  const has = (k: string) => Object.prototype.hasOwnProperty.call(share, k);
  const add = (k: string, amount: number) => {
    if (has(k)) share[k] += amount;
  };

  // دليلة شريكاً مستقلاً مع وجود Over Pax: حالةٌ لم يُرها أيّ مستند
  const unproven = has('daleela') && Object.values(raw).some((x) => x !== 0);

  const total = Object.values(raw).reduce((sum, x) => sum + (x || 0), 0);
  if (!total) return { share, unproven };

  if (unproven || !has('poseidon') || !has('amal')) {
    // بلا قاعدةٍ مُثبتة لهذه التركيبة: يبقى كلّ مبلغٍ على منشئه
    for (const v of active) add(v.key, raw[v.key] || 0);
    return { share, unproven };
  }

  // ثابتةٌ لا تنقلب: المنشأ لا يُغيّر الوجهة، والمجموع هو ما يُقسم.
  add('poseidon', total * OVER_PAX_BADAWI);
  add('amal', total * OVER_PAX_ETEHAD);
  return { share, unproven };
}

/**
 * تسوية Over Pax المحصَّل في صفاجا.
 *
 * المبلغ يبقى مادّياً عند حائزه، وكلّ شريكٍ يستحقّ حصّته الثابتة من **مجموع**
 * ما حُصّل. فالمُحوَّل إلى شريك = استحقاقه − ما بيده:
 *
 *   تحويل(i) = مجموع الصفاجا × نسبة(i) − صفاجا(i)
 *
 * ومجموع التحويلات صفرٌ بالضرورة — لا يُخلق مالٌ ولا يُعدم.
 *
 * وحسابها على مستند ١–١٥ أغسطس ٢٠٢٦ (٤٬٩٥٥.٦٠ على بوسيدون وحده):
 *   أمل      ٤٬٩٥٥.٦٠ × ٣٣.٣٣٪ − ٠        = +١٬٦٥١.٧٠
 *   بوسيدون  ٤٬٩٥٥.٦٠ × ٦٦.٦٧٪ − ٤٬٩٥٥.٦٠ = (١٬٦٥١.٧٠)
 *
 * ودليلة شريكاً مستقلّاً: حالةٌ لم يُرها مستند، فيبقى كلٌّ على ما بيده ويُعلَن.
 */
function splitSafagaOverPax(active: VesselInput[]): {
  transfer: Record<string, number>;
  total: number;
  unproven: boolean;
} {
  const transfer: Record<string, number> = {};
  for (const v of active) transfer[v.key] = 0;

  const has = (k: string) => Object.prototype.hasOwnProperty.call(transfer, k);
  const total = active.reduce((a, v) => a + n(v.overPaxSafaga), 0);
  const unproven = has('daleela') && total !== 0;

  if (!total || unproven || !has('poseidon') || !has('amal')) {
    return { transfer, total: r2(total), unproven };
  }

  transfer.poseidon = total * OVER_PAX_BADAWI - n(active.find((v) => v.key === 'poseidon')!.overPaxSafaga);
  transfer.amal = total * OVER_PAX_ETEHAD - n(active.find((v) => v.key === 'amal')!.overPaxSafaga);
  return { transfer, total: r2(total), unproven };
}

export function calculateDistribution(input: ModelInput): ModelResult {
  const days = Math.max(0, n(input.days));
  const rate = n(input.commissionRate);
  const perVoyage = n(input.perVoyageFee);

  const active = (input.vessels || []).filter(isActive);
  const partners = active.length;

  const missing: string[] = [];
  const warnings: string[] = [];

  if (!partners) missing.push('لا مركب نشط في الفترة');
  if (!days) missing.push('عدد الأيام صفر — راجع تاريخَي الفترة');

  const per = active.map((v) => {
    const sdBase = r2(n(v.sdBase) + n(v.sdAdjust));
    const fuel = r2(n(v.fuel) + n(v.fuelAdjust));
    const fee = r2(sdBase * (rate / 100) + n(v.voyages) * perVoyage);
    const rent = r2(days * n(v.dailyRate));
    return { v, sdBase, fuel, fee, rent };
  });

  const sum = (f: (x: (typeof per)[number]) => number) => per.reduce((a, x) => a + f(x), 0);

  const { share: overPaxShare, unproven: overPaxUnproven } = splitOverPax(active);
  const {
    transfer: safagaOpTransfer,
    total: totalOverPaxSafaga,
    unproven: safagaOpUnproven,
  } = splitSafagaOverPax(active);

  const totalCashDuba = r2(sum((x) => n(x.v.cashDuba)));
  const totalOverPax = r2(sum((x) => n(x.v.overPax)));
  const totalRent = r2(sum((x) => x.rent));
  const totalFuel = r2(sum((x) => x.fuel));
  const totalFee = r2(sum((x) => x.fee));
  const totalRevenue = r2(sum((x) => n(x.v.revenue)));
  const totalColl = sum((x) => n(x.v.netCollected));

  const div = partners || 1;
  const baseShare = totalCashDuba / div;
  const rentShare = totalRent / div;
  const fuelShare = totalFuel / div;
  const feeShare = totalFee / div;
  const avgNetCollected = totalColl / div;

  // نقد ضبا هو أساس التوزيع كلّه. غيابه لا يُنتج صفراً بل رقماً سالباً كبيراً
  // يبدو نتيجةً وهو نقصُ مُدخَل — فيُعلَن نقصاً صريحاً بدل أن يُعرض كحقيقة.
  if (partners && totalCashDuba === 0) {
    missing.push('نقد ضبا غير مُدخَل — التوزيع لا يُحتسب بدونه');
  }
  for (const x of per) {
    if (n(x.v.cashDuba) === 0 && n(x.v.voyages) > 0) {
      missing.push(`نقد ضبا غير مُدخَل لـ ${x.v.name}`);
    }
    if (n(x.v.sdAdjust) !== 0 || n(x.v.fuelAdjust) !== 0) {
      warnings.push(`${x.v.name}: تعديلٌ يدويّ مُطبَّق على الأساس أو الوقود`);
    }
    if (n(x.v.offHireSettlement) !== 0) {
      warnings.push(
        `${x.v.name}: تسوية إيقافٍ بمقدار ${r2(n(x.v.offHireSettlement))} — ` +
          'موضعها في سلسلة المستند غير معروف فلم تدخل الحساب',
      );
    }
  }
  if (overPaxUnproven) {
    warnings.push(
      'دليلة شريكٌ مستقلّ مع وجود Over Pax — قاعدة قسمته في هذه الحال لم ' +
        'يُبيّنها مستند، فبقي كلٌّ على منشئه',
    );
  }
  if (safagaOpUnproven) {
    warnings.push(
      'دليلة شريكٌ مستقلّ مع Over Pax محصَّلٍ في صفاجا — لم يُبيّنها مستند، ' +
        'فبقي كلٌّ على ما بيده ولم تُجرَ تسوية',
    );
  }

  const vessels: VesselResult[] = per.map((x) => {
    const opShare = overPaxShare[x.v.key] || 0;
    const adjustedProfit = baseShare + opShare;
    // المستند يطوي البندين في سطرٍ واحد اسمه `Sfaga Cash Adjustment`
    const safagaOpShare = safagaOpTransfer[x.v.key] || 0;
    const safagaAdjust = avgNetCollected - n(x.v.netCollected) + safagaOpShare;
    const dividend = adjustedProfit - rentShare - fuelShare - feeShare + safagaAdjust;
    // المستند يُنزل التوزيع إلى الدولار الصحيح ويُبقي الكسر رصيداً في ضبا،
    // ويكتبه سطراً مستقلّاً. فالكسر ليس فارقاً بل بندٌ في الورقة.
    const dividendPayable = Math.floor(r2(dividend));
    const deductedFromDuba = rentShare + fuelShare + feeShare + dividendPayable;
    const remainingAtDuba = adjustedProfit + safagaAdjust - deductedFromDuba;
    const liq = x.v.liquidity;

    /*
     * المقارنة على التوزيع **بالسنت** لا بالدولار الصحيح.
     *
     * التدوير كسرٌ دون الدولار، ولو دخل المقارنة لكسر صفريّة المجموع: ما
     * تكسبه سفينةٌ لا يساوي ما تخسره الأخرى إلّا بسنتات. والفارق هنا بالآلاف،
     * فالكسر ضجيجٌ لا معنى له.
     */
    const standalone = n(x.v.cashDuba) + n(x.v.netCollected)
      + n(x.v.overPax) + n(x.v.overPaxSafaga)
      - x.rent - x.fuel - x.fee;
    // وما حُصّل في صفاجا يبقى بيده في الحالين، فيدخل الطرفين ولا يكسر صفريّة المجموع
    const partnered = dividend + n(x.v.netCollected) + n(x.v.overPaxSafaga);

    return {
      key: x.v.key,
      name: x.v.name,
      voyages: n(x.v.voyages),
      revenue: r2(n(x.v.revenue)),
      sdBase: x.sdBase,
      sdAdjust: r2(n(x.v.sdAdjust)),
      fee: x.fee,
      fuel: x.fuel,
      fuelAdjust: r2(n(x.v.fuelAdjust)),
      rent: x.rent,
      cashDuba: r2(n(x.v.cashDuba)),
      netCollected: r2(n(x.v.netCollected)),
      overPax: r2(n(x.v.overPax)),
      overPaxShare: r2(opShare),
      overPaxSafaga: r2(n(x.v.overPaxSafaga)),
      safagaOverPaxShare: r2(safagaOpShare),
      adjustedProfit: r2(adjustedProfit),
      safagaAdjust: r2(safagaAdjust),
      dividend: r2(dividend),
      dividendPayable,
      deductedFromDuba: r2(deductedFromDuba),
      remainingAtDuba: r2(remainingAtDuba),
      dueToAccount: r2(dividendPayable + x.rent + x.fuel + x.fee),
      standalone: r2(standalone),
      partnered: r2(partnered),
      partnershipGain: r2(partnered - standalone),
      liquidityGap: liq == null ? null : r2(n(liq) - n(x.v.cashDuba)),
    };
  });

  return {
    days,
    partners,
    baseShare: r2(baseShare),
    totalCashDuba,
    totalOverPax,
    totalOverPaxSafaga,
    rentShare: r2(rentShare),
    fuelShare: r2(fuelShare),
    feeShare: r2(feeShare),
    totalRent,
    totalFuel,
    totalFee,
    totalRevenue,
    avgNetCollected: r2(avgNetCollected),
    vessels,
    missing,
    warnings,
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
 * الطريقة المقترحة — تُحسب بجوار المعتمدة ولا تحلّ محلّها
 * ═══════════════════════════════════════════════════════════════════════════ */

/** مركبٌ واحد في الطريقة المقترحة. */
export interface ProposedVesselResult {
  key: string;
  name: string;
  /** صافي الإيراد: الإيراد − العمولة − المصاريف */
  netRevenue: number;
  rent: number;
  /** الصافي بعد الخصم = صافي الإيراد − الإيجار */
  afterRent: number;
  /** تحصيل صفاجا — يُطرح كاملاً، لا بفارق المتوسّط */
  safaga: number;
  overPaxShare: number;
  /** الرصيد طرف البسّام */
  balanceAtBassam: number;
  /** البنكر — يُردّ لصاحبه كاملاً بلا قسمة */
  fuel: number;
  /** المستحقّ لحساب المركب */
  total: number;
}

export interface ProposedResult {
  /** تُحسب أو لا: تحتاج صافي إيراد كلّ شريكٍ فاعل */
  available: boolean;
  reason?: string;
  partners: number;
  /** مجموع «الصافي بعد الخصم» قبل القسمة */
  totalAfterRent: number;
  /** توزيع النسب = المجموع ÷ الشركاء */
  pooled: number;
  vessels: ProposedVesselResult[];
  grandTotal: number;
}

/**
 * الطريقة المقترحة — كما تحسبها ورقة الزميل.
 *
 * ── السلسلة ──
 *   صافي الإيراد (الإيراد − العمولة − المصاريف)
 *   − الإيجار                     ← لكلّ مركبٍ إيجاره
 *   = الصافي بعد الخصم
 *   ÷ الشركاء                     ← توزيع النسب: المجموع مناصفةً
 *   − تحصيل صفاجا                 ← لكلّ مركبٍ تحصيله كاملاً
 *   + حصّة Over Pax
 *   = الرصيد طرف البسّام
 *   + الإيجار                     ← يُردّ لصاحبه
 *   + البنكر                      ← يُردّ لصاحبه
 *   = المستحقّ لحساب المركب
 *
 * ── وأين تفترق عن المعتمدة ──
 * **١ · تبدأ من الإيراد لا من النقد.** المعتمدة تقسم نقد ضبا الفعليّ؛ وهذه
 * تقسم صافي الإيراد المشتقّ من الدفتر. فما بين الرقمين — فروق التحصيل
 * والتوقيت — يظهر في النتيجة.
 *
 * **٢ · لا عمولة توكيل فيها.** المعتمدة تخصم `الأساس × ٦.٥٪ + ٥٠٠ × رحلة`
 * مناصفةً وتردّ لكلٍّ عمولته؛ وهذه لا تذكرها. وهو الفرق الوحيد المرصود في
 * فترة ٢٠ يونيو – ٣ يوليو: ٣٬٠٢٩.٣٣ تنتقل بين الشريكين.
 *
 * **٣ · صفاجا تُطرح كاملة لا بفارق المتوسّط.** والنتيجة واحدة رياضيّاً حين
 * يكون الشركاء اثنين، لأنّ القسمة تسبق الطرح.
 *
 * **٤ · البنكر يُردّ بلا قسمة.** المعتمدة تخصم نصف المجموع ثمّ تردّ لكلٍّ وقوده؛
 * وهذه تردّه وحسب. ولا يظهر أثر ذلك هنا لأنّ صافي الإيراد لا يطرح البنكر أصلاً.
 *
 * **٥ · لا تدوير إلى الدولار الصحيح.** المعتمدة تُنزل التوزيع وتُبقي الكسر
 * رصيداً في ضبا؛ وهذه تُبقي الكسور.
 *
 * ── وما ثبت ──
 * أُعيد إنتاج ورقة ٢٠ يونيو – ٣ يوليو ٢٠٢٦ بالسنت من مدخلاتها وحدها:
 * أمل ٩٤٧٬٢٦٤.٠٣ وبوسيدون ٥٨٢٬٠٥٢.٧١.
 *
 * ── ولماذا قد لا تُحسب ──
 * صافي الإيراد ليس عموداً محفوظاً، بل يُجمع من تفصيل الرحلات الملتقَط مع
 * الفترة. ففترةٌ حُفظت قبل أن يوجد التفصيل لا صافي لها — وحسابها بأصفارٍ
 * يُنتج رقماً يبدو سليماً وهو باطل. فتُعلَن «غير متاحة» ولا تُخمَّن.
 */
export function calculateProposed(input: ModelInput): ProposedResult {
  const days = Math.max(0, n(input.days));
  const active = (input.vessels || []).filter(isActive);
  const partners = active.length;

  const empty: ProposedResult = {
    available: false, partners, totalAfterRent: 0, pooled: 0, vessels: [], grandTotal: 0,
  };
  if (!partners) return { ...empty, reason: 'لا شريكَ فاعلاً في هذه الفترة' };

  const naked = active.filter((v) => v.netRevenue == null || !Number.isFinite(Number(v.netRevenue)));
  if (naked.length) {
    return {
      ...empty,
      reason:
        `صافي الإيراد غير ملتقَط لـ ${naked.map((v) => v.name).join(' و')} — ` +
        'يُجمع من تفصيل الرحلات، فأعد الجلب لتُحسب هذه الطريقة',
    };
  }

  const { share: overPaxShare } = splitOverPax(active);

  const per = active.map((v) => {
    const netRevenue = n(v.netRevenue);
    const rent = days * n(v.dailyRate);
    return { v, netRevenue, rent, afterRent: netRevenue - rent };
  });

  const totalAfterRent = per.reduce((a, x) => a + x.afterRent, 0);
  const pooled = totalAfterRent / partners;

  const vessels: ProposedVesselResult[] = per.map((x) => {
    const safaga = n(x.v.netCollected);
    const opShare = overPaxShare[x.v.key] || 0;
    const balanceAtBassam = pooled - safaga + opShare;
    const fuel = n(x.v.fuel) + n(x.v.fuelAdjust);
    return {
      key: x.v.key,
      name: x.v.name,
      netRevenue: r2(x.netRevenue),
      rent: r2(x.rent),
      afterRent: r2(x.afterRent),
      safaga: r2(safaga),
      overPaxShare: r2(opShare),
      balanceAtBassam: r2(balanceAtBassam),
      fuel: r2(fuel),
      total: r2(balanceAtBassam + x.rent + fuel),
    };
  });

  return {
    available: true,
    partners,
    totalAfterRent: r2(totalAfterRent),
    pooled: r2(pooled),
    vessels,
    grandTotal: r2(vessels.reduce((a, v) => a + v.total, 0)),
  };
}
