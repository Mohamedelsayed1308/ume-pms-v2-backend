import { createHash } from 'crypto';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * تصنيف قيود QuickBooks COGS إلى بنود كارت الربحيّة — خالصٌ بلا قاعدة
 *
 * ── المبدأ ──
 * الخريطة **بقرار المالك في ٨ سبتمبر ٢٠٢٦** بعد عرض التصنيف عليه حساباً حساباً:
 *   - رسوم الميناء المصريّ وعمولة الوكالة: من QuickBooks بدل عمود EGY-PORT في الدفتر.
 *   - المرتّبات: من QuickBooks، وتُعامَل مرتّبات الشهر لا مشتريات.
 *   - التأمين: **من الوثيقة لا من الفواتير** — أقساط QuickBooks تُستبعد ويحلّ
 *     محلّها سطرٌ سنويّ لكلّ وثيقة يُقسَّط على شهورها.
 *   - إهلاك الدراي دوك: سطرٌ سنويّ واحد بدل القيود الشهريّة.
 *   - الزيوت: بندٌ مستقلّ — والكارت يعامل كلمة Bunker وقوداً، فلا تحمل الكلمة.
 *   - المياه العذبة: لا تُحمَّل، فهي في دفتر الرحلات بالدولار نفسه.
 *
 * ── ولماذا الحساب لا المورّد ──
 * المورّد يتغيّر ويتكرّر تحت حساباتٍ شتّى (بدوي يورّد التموينات والعمولة
 * والنثريّات). ورقم الحساب في QuickBooks هو التصنيف الذي اعتمده المحاسب أصلاً.
 * ═══════════════════════════════════════════════════════════════════════════
 */

export interface CogsRow {
  /** مسار الحساب من الملفّ: مثل "51 · Supplies & Maintenance / 533 · Supplies" */
  account_path: string;
  doc_type: string;
  /** YYYY-MM-DD */
  entry_date: string;
  doc_number: string;
  supplier: string;
  memo: string;
  amount_book: number | null;
  amount_usd: number;
  /** نصّ عمود «Depreciation» في الملفّ إن وُجد: "1 Year" · "3 Year" · "10 M" */
  depreciation_text?: string | null;
}

export interface Classified {
  account_code: string;
  category: string;
  item_label: string;
  depreciation_months: number | null;
  charged: boolean;
  exclude_reason: string;
  /** حسابٌ لم يرد في الخريطة — يُعرض في الخطّة ولا يُخفى */
  unmapped: boolean;
}

interface Rule { category: string; label: string; charged?: false; reason?: string }

const MAINT: Rule = { category: 'maintenance', label: 'صيانة وقطع غيار' };
const COMMS: Rule = { category: 'communications', label: 'اتّصالات' };
const SOFT: Rule = { category: 'software', label: 'برمجيّات وملاحة' };

export const ACCOUNT_RULES: Record<string, Rule> = {
  '5002': { category: 'drydock', label: 'إهلاك دراي دوك', charged: false, reason: 'يحلّ محلّه سطرٌ سنويّ يُقسَّط على 12 شهراً' },
  '503': COMMS, '542': COMMS, '548': COMMS,
  '520': SOFT, '554': SOFT, '558': SOFT, '537': SOFT,
  '504': MAINT, '506': MAINT, '507': MAINT, '510': MAINT, '512': MAINT, '514': MAINT, '515': MAINT,
  '518': MAINT, '519': MAINT, '521': MAINT, '535': MAINT, '536': MAINT, '538': MAINT, '539': MAINT,
  '562': MAINT, '564': MAINT, '571': MAINT, '572': MAINT, '573': MAINT, '574': MAINT, '576': MAINT,
  '577': MAINT, '578': MAINT, '579': MAINT, '581': MAINT, '582': MAINT, '583': MAINT,
  '523': { category: 'logistics', label: 'لوجستيّات' },
  '533': { category: 'supplies', label: 'تموينات' },
  '541': { category: 'travel', label: 'انتقالات وإقامة' },
  '544': { category: 'fines', label: 'تعويضات وغرامات' },
  '5501': { category: 'management', label: 'إدارة فنّيّة' },
  '555': { category: 'classification', label: 'تصنيف' },
  '5201': { category: 'insurance', label: 'تأمين H&M', charged: false, reason: 'التأمين يُستحقّ من الوثيقة لا من الأقساط' },
  '5202': { category: 'insurance', label: 'تأمين P&I', charged: false, reason: 'التأمين يُستحقّ من الوثيقة لا من الأقساط' },
  '5203': { category: 'insurance', label: 'تأمين War', charged: false, reason: 'التأمين يُستحقّ من الوثيقة لا من الأقساط' },
  '5312': { category: 'salary', label: 'مرتّبات' },
  '5314': { category: 'crew_medical', label: 'طاقم — طبّيّ' },
  '5315': { category: 'crew_travel', label: 'طاقم — سفر' },
  '5292': { category: 'ksa_port', label: 'ميناء السعودية — نثريّات' },
  '5301': { category: 'egy_agency', label: 'عمولة الوكالة — مصر' },
  '5305': { category: 'egy_port', label: 'رسوم ميناء مصر' },
  '5306': { category: 'egy_petties', label: 'نثريّات ميناء مصر' },
  '5307': { category: 'egy_port', label: 'سيّارات — مصر' },
  '5401': { category: 'broker', label: 'سمسرة صفاجا' },
  '53201': { category: 'provision', label: 'تموين طاقم' },
  '53203': { category: 'fresh_water', label: 'مياه عذبة', charged: false, reason: 'في دفتر الرحلات (عمود F.W) بالدولار نفسه' },
  '53402': { category: 'lubricants', label: 'زيوت' },
  '53403': { category: 'lubricants', label: 'زيوت' },
};

/** الفئات التي يعرضها الكارت مشترياتٍ تُقسَّط — كلّ ما ليس مرتّباتٍ ولا مستبعَداً */
export const SALARY_CATEGORY = 'salary';

/**
 * رقم الحساب: آخر مقطعٍ في المسار قبل «·». "51 · A / 533 · B" → "533".
 * والفرعيّ يغلب الأصل: "550 · UME DMCC / 5501 · Management" → "5501".
 */
export function accountCode(accountPath: string): string {
  const segs = String(accountPath || '').split('/').map((s) => s.trim()).filter(Boolean);
  for (let i = segs.length - 1; i >= 0; i--) {
    const code = segs[i].split('·')[0].trim();
    if (/^\d+$/.test(code)) return code;
  }
  return '';
}

/**
 * عمود الإهلاك كما يكتبه المحاسب: "1 Year" · "3 Year" · "5 Year" · "10 M" · "2 M"
 * · "1 Year/ ask". السنة 12 شهراً، و"M" شهور. وما لا يُفهم يُترك فارغاً ويُعلَم.
 */
export function parseDepreciation(text: string | null | undefined): number | null {
  const t = String(text || '').trim().toLowerCase();
  if (!t) return null;
  const y = t.match(/(\d+)\s*(?:year|yr|y)\b/);
  if (y) return Number(y[1]) * 12;
  const m = t.match(/(\d+)\s*(?:months?|m)\b/);
  if (m) return Number(m[1]);
  return null;
}

export function classify(row: CogsRow): Classified {
  const code = accountCode(row.account_path);
  const rule = ACCOUNT_RULES[code];
  if (!rule) {
    return { account_code: code, category: 'other', item_label: 'أخرى', depreciation_months: null, charged: true, exclude_reason: '', unmapped: true };
  }
  return {
    account_code: code,
    category: rule.category,
    item_label: rule.label,
    depreciation_months: rule.charged === false ? null : parseDepreciation(row.depreciation_text),
    charged: rule.charged !== false,
    exclude_reason: rule.reason || '',
    unmapped: false,
  };
}

/**
 * بصمة القيد — ما يميّزه في دفتر QuickBooks: الحساب والنوع والتاريخ ورقم
 * المستند والمورّد ومبلغ الدفتر. **لا المذكّرة**: تُحرَّر بعد القيد بلا تغيير
 * الرقم، وإدخالها يجعل تصحيحاً إملائيّاً قيداً جديداً.
 */
export function dedupeKey(vessel: string, row: CogsRow, code: string): string {
  const amt = row.amount_book != null ? Number(row.amount_book).toFixed(2) : Number(row.amount_usd).toFixed(2);
  const raw = [vessel, code, row.doc_type, row.entry_date, row.doc_number, row.supplier, amt]
    .map((s) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' '))
    .join('|');
  return createHash('sha256').update(raw).digest('hex');
}

/** فحص صفٍّ قبل أن يُخطَّط: تاريخٌ صالح ومبلغٌ رقميّ. */
export function rowError(row: CogsRow): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(row.entry_date || ''))) return 'تاريخٌ غير صالح';
  if (!Number.isFinite(Number(row.amount_usd))) return 'مبلغٌ غير رقميّ';
  if (!String(row.account_path || '').trim()) return 'بلا حساب';
  return null;
}
