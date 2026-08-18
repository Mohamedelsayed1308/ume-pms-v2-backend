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
 * حمولة رحلةٍ من `DATA` → الشكل الذي تعرضه الشاشة.
 *
 * الشهر من تاريخ المغادرة، و`monthAlt` من الوصول. الشاشة تُرجّح الأول وتسقط إلى
 * الثاني — فرحلةٌ بلا تاريخ مغادرة تُعرض ولا تُحذف.
 */
export function toSheetVoyage(p: any, spec: SheetVesselSpec): SheetVoyage {
  const month = p.dateExp ? String(p.dateExp).slice(0, 7) : null;
  const monthAlt = p.dateImp ? String(p.dateImp).slice(0, 7) : null;
  return {
    ref: p.ref,
    month, monthAlt,
    date: String(p.dateExp || p.dateImp || ''),
    E: side(p, 'E', spec.exportExp),
    I: side(p, 'I', spec.importExp),
    bunker: n(p.bnk),
    net: n(p.net),
    O: n(p.collO),
    P: n(p.collP),
    bassamLiq: 0,
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
