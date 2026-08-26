/**
 * ── قراءة رحلات المركب من الشيت الموحّد ──
 *
 * صار الشيت `DATA` مصدر الحقيقة الوحيد، ويُغذّى بسحبٍ يومي من دفاتر المراكب على
 * درايف. فتقرأ شاشة الربحية منه بدل ملفٍّ يرفعه إنسانٌ متى تذكّر.
 *
 * ── لماذا هنا لا في الواجهة ──
 * الواجهة كانت تفكّ الإكسل بنفسها وتُثبّت الأعمدة بأرقامها: `balance: 35`
 * لألكوديا و`32` لبيلاجوس و`bassamLiq: 36` يشير إلى عمودٍ فارغ تماماً. وأي
 * تعديل في دفتر المركب يُزحزح الأرقام فتُقرأ خانةٌ مكان أخرى بلا خطأ يظهر.
 * والشيت يُسلّم حقولاً مُسمّاة، فتزول هذه الهشاشة من أصلها.
 *
 * ── والشكل يبقى كما هو ──
 * المخرجات بشكل `Voyage` الذي تنتظره الشاشة حرفياً — الرِّجلان `E` و`I` وداخل
 * كلٍّ أعدادها ومبالغها ومصاريفها. فلا يتغيّر حساب الشاشة ولا عرضها، ويبقى
 * الرفع اليدوي بديلاً صالحاً لأن الشكلين واحد.
 */

/** مفاتيح المصاريف كما تُسمّيها الشاشة، مقابل حقول الحمولة في الشيت. */
export interface ExpenseMap {
  [screenKey: string]: string;   // مفتاح الشاشة → اسم الحقل في الحمولة (بلا لاحقة الرِّجل)
}

export interface SheetVesselSpec {
  vessel: string;                // اسم المركب في `DATA`
  exportExp: ExpenseMap;
  importExp: ExpenseMap;
}

/*
 * خرائط المصاريف.
 *
 * الأسماء تختلف بين المركبين لأن نموذجيهما يختلفان فعلاً: بيلاجوس له «منطقة حرة
 * 2%» ولا ضريبة تفريغ، وألكوديا له ضريبة أمر تفريغ و«خصم خاص». والمفاتيح هنا
 * هي عين مفاتيح `exportExp`/`importExp` في إعداد الشاشة، فلا يتغيّر عرضٌ ولا
 * عنوان.
 */
export const SHEET_VESSELS: Record<string, SheetVesselSpec> = {
  Alcudia: {
    vessel: 'ALCUDIA',
    exportExp: {
      otherExpsE: 'oth', dischargeOrderTax: 'aa', disShiOrder60: 'ab',
      frtDep: 'ac', vehicle12: 'ad', pks12: 'ae', broker: 'brk', egyPort: 'pg',
    },
    importExp: {
      fw: 'fw', comm10: 'r', commVehicle: 's', comm20: 't',
      specialDisc: 'sd', elbassam: 'eb', telcome: 'tel', othersI: 'oth', ksaPort: 'pk',
    },
  },
  /*
   * بوسيدون — خريطةٌ مطابقةٌ لألكوديا، وليست نسخاً بالظنّ.
   *
   * قُورن رأسا الدفترين عموداً بعمود في الشيت الموحّد (`تقرير POSEIDON` و
   * `تقرير ALCUDIA`) فتطابقا: `ضريبة تفريغ` و`عمولة تفريغ 60%` و`مركبات 12%`
   * و`ركاب PKS` و`استيراد 10%` و`مركبات 15%` و`ركاب 20%` … إلى `ميناء EGY`.
   *
   * وسبعةٌ من الحقول صفرٌ في رحلاته الـ١٨٤ كلّها — `ab` و`ac` و`brk` و`fz`
   * و`crn` و`sd` و`dis`. **وتبقى في الخريطة** لا تُحذف: حذفُها يُخفي بنداً إن
   * بدأ الدفتر يملؤه غداً، والصفرُ المعروض يقول «لا شيء هنا» بصوتٍ مسموع.
   *
   * ── وما ليس هنا ──
   * `cashDuba` و`cashSafaga` و`overPax` مفاهيمُ توزيعٍ لا تشغيل، وموضعها شاشة
   * توزيع الأرباح. وعرضُ الرقم في شاشتين يجعل من يقرأ إحداهما يظنّ الأخرى خطأً.
   */
  Poseidon: {
    vessel: 'POSEIDON',
    exportExp: {
      otherExpsE: 'oth', dischargeOrderTax: 'aa', disShiOrder60: 'ab',
      frtDep: 'ac', vehicle12: 'ad', pks12: 'ae', broker: 'brk', egyPort: 'pg',
      /*
       * ── وهنا يفترق عن ألكوديا ──
       * `ميناء السعودية` مقروءٌ من رِجل الوارد وحدها في ألكوديا وبيلاجوس، وهو
       * صحيحٌ عندهما: `pk_E` صفرٌ في رحلاتهما كلّها (٤١٣ رحلة).
       *
       * وبوسيدون يسجّل جزءاً منه على رِجل الصادر — **١١٦٬٦٤٣.٧٠ في ١٦ رحلة**.
       * فنسخُ الخريطة كما هي كان يُسقطها صامتةً، ويُظهر مصروفاتٍ أقلّ من
       * الحقيقة وربحاً أعلى.
       *
       * ولا يُترك بندٌ مقروءاً من جانبٍ واحد بعد اليوم: `ميناء مصر` كذلك يُقرأ
       * من الجانبين — وهو صفرٌ في الوارد اليوم، فيظهر صفراً ولا يسقط غداً.
       */
      ksaPortE: 'pk',
    },
    importExp: {
      fw: 'fw', comm10: 'r', commVehicle: 's', comm20: 't',
      specialDisc: 'sd', elbassam: 'eb', telcome: 'tel', othersI: 'oth', ksaPort: 'pk',
      egyPortI: 'pg',
    },
  },
  Pelagos: {
    vessel: 'PELAGOS',
    exportExp: {
      shipOrder60: 'ab', freeZone2: 'fz', toursVeh12: 'ad',
      toursPks12: 'ae', cargo: 'ac', egyPort: 'pg',
    },
    importExp: {
      comm10: 'r', comm15: 's', comm20: 't', fw: 'fw',
      others: 'oth', elbassam: 'eb', ksaPort: 'pk',
    },
  },
};

export interface SheetSide {
  truckC: number; truck: number; vehC: number; veh: number;
  passC: number; pass: number; houryaC: number; discharge: number;
  exp: Record<string, number>;
}
export interface SheetVoyage {
  ref: any; month: string | null; monthAlt: string | null;
  /*
   * تاريخ الرحلة كاملاً لا شهرها.
   *
   * الشاشة تعرض شهراً واحداً، والسؤال «أوصلت رحلات الأمس؟» لا يُجاب بالشهر.
   * فيُحمل التاريخ ليُعرف أحدث ما في الدفتر بيومه.
   */
  date: string;
  E: SheetSide; I: SheetSide;
  bunker: number; net: number; O: number; P: number; bassamLiq: number;
}

/**
 * أول سنةٍ تُقرأ سيولتها.
 *
 * ما قبل 2026 محسوبٌ بتعريفٍ قديم يفرّق بين `P.P` و`C.C` لا يطابق ما يشتقّه
 * المحلّل اليوم من الدفتر. فبقاؤه يخلط تعريفين في عمودٍ واحد ويُنتج رصيداً
 * تراكمياً لا يُطابق شيئاً — والمالك أمر بمنعه.
 *
 * والمنع هنا لا في الشيت: الشيت يحتفظ بالأرقام كما هي للمراجعة، والشاشة وحدها
 * تتجاهلها.
 */
const LIQ_FROM_YEAR = 2026;

const n = (v: any) => (typeof v === 'number' && isFinite(v) ? v : Number(v) || 0);

function side(p: any, leg: 'E' | 'I', map: ExpenseMap): SheetSide {
  const exp: Record<string, number> = {};
  for (const key of Object.keys(map)) {
    // الحقل مفصولٌ بالرِّجل — وغيابه يعني أن البند لا يقع على هذه الرِّجل، فصفر
    exp[key] = n(p[`${map[key]}_${leg}`]);
  }
  return {
    truckC: n(p[`nTruck_${leg}`]),
    truck: n(p[leg === 'E' ? 'trE' : 'trI']),
    vehC: n(p[`nVeh_${leg}`]),
    veh: n(p[leg === 'E' ? 'vhE' : 'vhI']),
    passC: n(p[`nPax_${leg}`]),
    pass: n(p[leg === 'E' ? 'pxE' : 'pxI']),
    houryaC: n(p[`pkNo_${leg}`]),
    discharge: n(p[`dis_${leg}`]),
    exp,
  };
}

/**
 * شهرٌ صالحٌ أو لا شيء.
 *
 * ── ولماذا لا يكفي `slice(0, 7)` ──
 * كان الشهر يُقتطع من التاريخ بلا سؤالٍ عن شكله. فرحلة ألكوديا `#41` تحمل في
 * الشيت `dateExp = "204-11-27"` — خطأُ طباعةٍ تنقصه خانة — فصار شهرها `204-11`.
 *
 * والشهور تُرتَّب **نصّاً**، و`204-11` يسبق `2026-08` عند المقارنة حرفاً بحرف
 * (الخانة الثالثة `4` أكبر من `2`) — فوقع في آخر الترتيب. والشاشة تفتح على آخر
 * شهر، فهبطت على دلوٍ فيه رحلةٌ واحدة، وبدت مئتان وستّ رحلاتٍ من ٢٠٢٥ و٢٠٢٦
 * كأنّها اختفت. ولم تختفِ: كانت في القائمة تحته.
 *
 * فسطرٌ واحدٌ مشوَّهٌ في الدفتر كان يكفي ليخطف الشاشة كلَّها.
 *
 * والسنة تُقيَّد بـ `19xx` أو `20xx`، والشهر بـ `01`–`12`. وما خالف ذلك يُعامَل
 * **كأنّه غائب** — فيرتدّ إلى تاريخ الوصول كما يرتدّ عند الغياب أصلاً.
 */
const VALID_MONTH = /^(19|20)\d{2}-(0[1-9]|1[0-2])$/;

export function monthOf(date: unknown): string | null {
  if (date === null || date === undefined || date === '') return null;
  const m = String(date).slice(0, 7);
  return VALID_MONTH.test(m) ? m : null;
}

/**
 * حمولة رحلةٍ من `DATA` → الشكل الذي تعرضه الشاشة.
 *
 * الشهر من تاريخ المغادرة، و`monthAlt` من الوصول. الشاشة تُرجّح الأول وتسقط إلى
 * الثاني — فرحلةٌ بلا تاريخ مغادرة **أو بتاريخٍ مشوَّه** تُعرض ولا تُحذف.
 */
/** سنة الرحلة: من حقلها إن وُجد، وإلا من تاريخها. */
function liqYear(p: any): number {
  const y = Number(p?.year);
  if (y) return y;
  return Number(String(p?.dateExp || p?.dateImp || '').slice(0, 4)) || 0;
}

export function toSheetVoyage(p: any, spec: SheetVesselSpec): SheetVoyage {
  const month = monthOf(p.dateExp);
  const monthAlt = monthOf(p.dateImp);
  return {
    ref: p.ref,
    month, monthAlt,
    /*
     * التاريخ المعروض يُفضّل الصالح.
     *
     * فرحلةٌ حُفظ فيها تاريخُ مغادرةٍ مشوَّه كانت تُظهره في رأس الشاشة
     * («أحدث رحلة في الشيت: #41 · 204-11-27») بينما تاريخ وصولها سليم.
     * وتصحيحُ الدفتر يبقى واجباً — لكنّ الشاشة لا تُردّد الخطأ في أثنائه.
     */
    date: String((monthOf(p.dateExp) ? p.dateExp : null) || (monthOf(p.dateImp) ? p.dateImp : null) || p.dateExp || p.dateImp || ''),
    E: side(p, 'E', spec.exportExp),
    I: side(p, 'I', spec.importExp),
    bunker: n(p.bnk),
    net: n(p.net),
    O: n(p.collO),
    P: n(p.collP),
    /*
     * السيولة عند الوكيل.
     *
     * كانت تُصفَّر هنا صراحةً لأن الشيت لم يكن يحملها: أنبوب السحب كان يستثني
     * الحقل ويُبقيه كما هو، فتجمّد عند الرحلات القديمة وصار صفراً في الجديدة.
     * وقد صار المحلّل يشتقّها من المصدر (صافي رِجل الوارد زائد بنكرها) فتُقرأ
     * كبقيّة الحقول.
     *
     * وشاشة حساب البسّام كانت تقول «السيولة مش ظاهرة» وهي محقّة — لا لأن
     * الرحلات ناقصة بل لأن هذا السطر يمحو الرقم قبل أن يصلها.
     */
    bassamLiq: liqYear(p) >= LIQ_FROM_YEAR ? n(p.liq) : 0,
  };
}

/**
 * يُحوّل صفوف `DATA` كلّها إلى رحلات المركب المطلوب.
 *
 * الصفوف بلا حمولةٍ صالحة تُتخطّى بصمت — صفٌّ واحد تالف لا يُسقط تقريراً كاملاً.
 * ومن لا تاريخ له إطلاقاً يُستبعَد لأن الشاشة تعرض بالشهر.
 */
export function voyagesFromData(rows: any[][], vesselKey: string): SheetVoyage[] {
  const spec = SHEET_VESSELS[vesselKey];
  if (!spec) return [];
  const out: SheetVoyage[] = [];
  for (const row of rows) {
    const raw = row && row[10];
    if (!raw) continue;
    let p: any;
    try { p = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { continue; }
    if (!p || p.vessel !== spec.vessel) continue;
    const v = toSheetVoyage(p, spec);
    if (v.month == null && v.monthAlt == null) continue;
    if (v.month == null) v.month = v.monthAlt;
    out.push(v);
  }
  return out;
}
