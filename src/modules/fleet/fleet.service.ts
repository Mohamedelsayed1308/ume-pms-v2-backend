import { Injectable, InternalServerErrorException } from '@nestjs/common';
import axios from 'axios';
import * as XLSX from 'xlsx';

// شيت جوجل المُجمّع لكل مراكب الأسطول (IMPORTRANGE) — قابل للتهيئة عبر متغير بيئة.
const SHEET_ID = process.env.FLEET_SHEET_ID || '1G7VU_z7WDZK6kq-7Sk_iLztJzmP-HlXe4ke6UtFn4fM';
const EXPORT_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=xlsx`;
const CACHE_MS = 5 * 60 * 1000; // 5 دقائق

export interface MonthRow {
  vessel: string; month: string; voyages: number; net: number; avgNet: number;
  revenue: number; expenses: number; liquidity: number;
  trucks: number; vehicles: number; passengers: number;
}
export interface VoyageRow {
  vessel: string; ref: string; date: string; month: string; direction: string;
  trucks: number; vehicles: number; passengers: number;
  revenue: number; commissions: number; expenses: number; net: number; liquidity: number; bunker: number;
}
/**
 * مرجعية القراءة — من أين جاء كل رقم على الشاشة.
 *
 * التفسير يطابق **عناوين عربية** لا أرقام أعمدة، وهو اختيارٌ متين ضدّ إعادة
 * ترتيب الأعمدة. لكن ثمنه أن تغيير عنوانٍ في الشيت يُسقط عموده إلى صفر **بلا
 * ضجيج**: لا خطأ، ولا سجلّ، ولوحةٌ تبدو سليمة وأرقامها ناقصة.
 *
 * ولذلك تُنشر الخريطة المُستَنتَجة إلى الواجهة: أيّ عنوانٍ طُوبق، وفي أيّ عمود،
 * وأيّها لم يُوجَد. العمود المفقود يصير مرئياً بدل أن يمرّ صامتاً.
 */
export interface ColumnMap {
  field: string;
  label: string;
  header: string | null;   // العنوان كما هو مكتوب في الشيت
  column: string | null;   // حرف العمود — A, B, C …
}
export interface TabReport {
  name: string;
  role: string;
  found: boolean;
  headerRow: number | null;  // رقم الصف كما يراه المستخدم (يبدأ من ١)
  rows: number;
  columns: ColumnMap[];
  missing: string[];
}
/**
 * آخر سحبٍ ناجح — نبض الأنبوب.
 *
 * البريد يُنبّه حين **يفشل** السحب. لكن مُنبّهاً يُحذف أو لا يُطلق لا يُنتج
 * فشلاً يُبلَّغ عنه — يصمت فحسب، والأرقام تبقى معروضة كأنها اليوم. فيُقرأ آخر
 * سطرٍ في `_ImportLog` ويُحسب عمره: الصمت نفسه يصير مرئياً.
 */
export interface LastImport {
  at: string | null;        // ISO — لا يلتبس بمنطقةٍ زمنية
  ageHours: number | null;
  stale: boolean;           // تجاوز نصف يومٍ بلا سحب
  status: string | null;
}

export interface FleetSource {
  sheetId: string;
  sheetUrl: string;
  tabs: TabReport[];
  cacheMinutes: number;
  fetchedAt: string;   // متى جُلب الشيت فعلاً
  stale: boolean;      // معروضٌ من آخر نسخة ناجحة بعد فشل جلبٍ أو تفسير
  staleReason: string | null;
  lastImport: LastImport;
}

export interface FleetData {
  vessels: string[];
  months: string[];
  monthly: MonthRow[];
  voyages: VoyageRow[];
  generatedAt: string;
  source: FleetSource;
}

let cache: { data: FleetData; at: number } | null = null;

const norm = (s: any) =>
  String(s ?? '').replace(/ـ/g, '').replace(/[ً-ْ]/g, '').replace(/\s+/g, ' ').trim();
const num = (v: any) => {
  if (v == null || v === '') return 0;
  if (typeof v === 'number') return isFinite(v) ? v : 0;
  const s = String(v);
  const neg = /^\s*\(.*\)\s*$/.test(s); // نمط محاسبي: (500) = -500
  const n = parseFloat(s.replace(/[,٬]/g, '').replace(/[^\d.\-]/g, ''));
  if (!isFinite(n)) return 0;
  return neg ? -Math.abs(n) : n;
};
// تحويل رقم تسلسلي (Excel) أو تاريخ نصّي إلى YYYY-MM
function toMonth(v: any): string | null {
  if (typeof v === 'number' && isFinite(v)) {
    const d = XLSX.SSF.parse_date_code(v);
    if (d && d.y) return `${d.y}-${String(d.m).padStart(2, '0')}`;
  }
  const s = String(v ?? '');
  let m = s.match(/(\d{4})[-/](\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}`;
  m = s.match(/(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}`;
  return null;
}
function toDate(v: any): string {
  if (typeof v === 'number' && isFinite(v)) {
    const d = XLSX.SSF.parse_date_code(v);
    if (d && d.y) return `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`;
  }
  return String(v ?? '');
}

// رقم عمود → حرفه كما يظهر في جوجل شيت (0 → A، 26 → AA)
function colLetter(i: number): string {
  let s = '';
  for (let n = i; n >= 0; n = Math.floor(n / 26) - 1) s = String.fromCharCode(65 + (n % 26)) + s;
  return s;
}

/*
 * المطابقة تتجاهل حالة الأحرف.
 *
 * `norm` نفسها لا تُصغّر: نتيجتها تُستعمل قيمةً معروضة أيضاً — أسماء المراكب —
 * وتصغيرها يقلب ALCUDIA إلى alcudia على الشاشة. فالتصغير هنا، في البحث وحده.
 *
 * وهذا ليس احتياطاً نظرياً: تبويب `LookerData` يكتب عنوانه `REF` بحروف كبيرة،
 * فكان بحثٌ عن `ref` يُخفق ويُسقط **570 صفاً** بلا خطأ ولا سجلّ.
 */
const key = (v: any) => norm(v).toLowerCase();

// يبني خريطة (مفتاح منطقي → رقم عمود) من صف العناوين حسب كلمات مفتاحية
function colIndex(headers: any[], ...keywords: string[]): number {
  for (let i = 0; i < headers.length; i++) {
    const h = key(headers[i]);
    if (h && keywords.every((k) => h.includes(k.toLowerCase()))) return i;
  }
  return -1;
}

function findHeaderRow(rows: any[][], mustHave: string[]): number {
  for (let r = 0; r < Math.min(6, rows.length); r++) {
    const line = key((rows[r] || []).join('|'));
    if (mustHave.every((k) => line.includes(k.toLowerCase()))) return r;
  }
  return -1;
}

/** يترجم خريطة الأعمدة المُستَنتَجة إلى تقريرٍ يُعرَض للمستخدم. */
function report(H: any[], c: Record<string, number>, labels: Record<string, string>): {
  columns: ColumnMap[]; missing: string[];
} {
  const columns = Object.keys(labels).map((field) => ({
    field,
    label: labels[field],
    header: c[field] >= 0 ? String(H[c[field]] ?? '').trim() : null,
    column: c[field] >= 0 ? colLetter(c[field]) : null,
  }));
  return { columns, missing: columns.filter((x) => x.column === null).map((x) => x.label) };
}

const MONTHLY_LABELS: Record<string, string> = {
  vessel: 'المركب', month: 'الشهر', voyages: 'عدد الرحلات', net: 'صافي الربح',
  revenue: 'الإيراد', expenses: 'المصروفات', liquidity: 'السيولة',
  trucks: 'الشاحنات', vehicles: 'السيارات', passengers: 'الركاب',
};
const VOYAGE_LABELS: Record<string, string> = {
  vessel: 'المركب', ref: 'المرجع', date: 'التاريخ', month: 'الشهر', direction: 'النوع',
  trucks: 'الشاحنات', vehicles: 'السيارات', passengers: 'الركاب', revenue: 'الإيراد',
  commissions: 'العمولات', expenses: 'المصروفات', net: 'الصافي', liquidity: 'السيولة',
  bunker: 'البانكر',
};

interface Parsed<T> { rows: T[]; headerRow: number | null; columns: ColumnMap[]; missing: string[] }
const EMPTY = { rows: [] as any[], headerRow: null, columns: [], missing: ['صف العناوين نفسه'] };

function parseMonthly(ws: XLSX.WorkSheet): Parsed<MonthRow> {
  const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });
  const hr = findHeaderRow(rows, ['المركب', 'الشهر']);
  if (hr < 0) return { ...EMPTY };
  const H = rows[hr];
  const c = {
    vessel: colIndex(H, 'المركب'),
    month: colIndex(H, 'الشهر'),
    voyages: colIndex(H, 'عدد', 'الرحلات'),
    net: colIndex(H, 'اجمالي', 'الصافي') >= 0 ? colIndex(H, 'اجمالي', 'الصافي') : colIndex(H, 'إجمالي', 'الصافي'),
    revenue: colIndex(H, 'الايراد') >= 0 ? colIndex(H, 'الايراد') : colIndex(H, 'الإيراد'),
    expenses: colIndex(H, 'المصاريف'),
    liquidity: colIndex(H, 'السيولة'),
    trucks: colIndex(H, 'عدد', 'الشاحنات'),
    vehicles: colIndex(H, 'عدد', 'المركبات'),
    passengers: colIndex(H, 'عدد', 'الركاب'),
  };
  const out: MonthRow[] = [];
  for (let r = hr + 1; r < rows.length; r++) {
    const row = rows[r]; if (!row) continue;
    const vessel = norm(row[c.vessel]);
    const month = toMonth(row[c.month]);
    if (!vessel || !month) continue;
    const voyages = num(row[c.voyages]);
    const net = num(row[c.net]);
    out.push({
      vessel, month, voyages, net,
      avgNet: voyages ? net / voyages : 0,
      revenue: num(row[c.revenue]), expenses: num(row[c.expenses]), liquidity: num(row[c.liquidity]),
      trucks: num(row[c.trucks]), vehicles: num(row[c.vehicles]), passengers: num(row[c.passengers]),
    });
  }
  return { rows: out, headerRow: hr + 1, ...report(H, c, MONTHLY_LABELS) };
}

function parseVoyages(ws: XLSX.WorkSheet): Parsed<VoyageRow> {
  const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });
  const hr = findHeaderRow(rows, ['المركب', 'ref']);
  if (hr < 0) return { ...EMPTY };
  const H = rows[hr];
  const c = {
    vessel: colIndex(H, 'المركب'),
    ref: colIndex(H, 'ref'),
    date: colIndex(H, 'التاريخ'),
    month: colIndex(H, 'الشهر'),
    direction: colIndex(H, 'النوع'),
    trucks: colIndex(H, 'عدد', 'الشاحنات'),
    vehicles: colIndex(H, 'عدد', 'المركبات'),
    passengers: colIndex(H, 'عدد', 'الركاب'),
    revenue: colIndex(H, 'الايراد') >= 0 ? colIndex(H, 'الايراد') : colIndex(H, 'الإيراد'),
    commissions: colIndex(H, 'العمولات'),
    expenses: colIndex(H, 'المصاريف'),
    net: colIndex(H, 'الصافي'),
    liquidity: colIndex(H, 'السيولة'),
    bunker: colIndex(H, 'بانكر') >= 0 ? colIndex(H, 'بانكر') : colIndex(H, 'بنكر'),
  };
  const out: VoyageRow[] = [];
  for (let r = hr + 1; r < rows.length; r++) {
    const row = rows[r]; if (!row) continue;
    const vessel = norm(row[c.vessel]);
    if (!vessel) continue;
    const month = toMonth(row[c.month]) || toMonth(row[c.date]);
    if (!month) continue;
    out.push({
      vessel, ref: String(row[c.ref] ?? ''), date: toDate(row[c.date]), month,
      direction: norm(row[c.direction]),
      trucks: num(row[c.trucks]), vehicles: num(row[c.vehicles]), passengers: num(row[c.passengers]),
      revenue: num(row[c.revenue]), commissions: num(row[c.commissions]), expenses: num(row[c.expenses]),
      net: num(row[c.net]), liquidity: num(row[c.liquidity]), bunker: num(row[c.bunker]),
    });
  }
  return { rows: out, headerRow: hr + 1, ...report(H, c, VOYAGE_LABELS) };
}

/**
 * آخر سطرٍ إجمالي في `_ImportLog` — عمود `UTC` نصّاً.
 *
 * يُقرأ من الآخر إلى الأول: السجلّ يُلحَق، فآخر تشغيلٍ في آخره. وغياب الورقة
 * أو العمود ليس خطأً — قد يكون الأنبوب لم يُركَّب بعد.
 */
function lastImport_(ws: XLSX.WorkSheet | undefined): LastImport {
  const none: LastImport = { at: null, ageHours: null, stale: true, status: null };
  if (!ws) return none;
  const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });
  for (let r = rows.length - 1; r >= 1; r--) {
    const row = rows[r] || [];
    if (String(row[1] ?? '').indexOf('الإجمالي') < 0) continue;
    const iso = String(row[7] ?? '').trim();
    if (!iso) continue;
    const t = Date.parse(iso);
    if (!isFinite(t)) continue;
    const ageHours = Math.round(((Date.now() - t) / 3600000) * 10) / 10;
    // نصف يوم: المدى بين تشغيلين مجدوَلين ثمانِ ساعات، فتجاوز اثنتي عشرة تخطٍّ لواحدٍ كامل
    return { at: iso, ageHours, stale: ageHours > 12, status: String(row[2] ?? '') || null };
  }
  return none;
}

/**
 * يَسِم النسخة المُخزَّنة بأنها قديمة وبسبب ذلك.
 *
 * الرجوع لآخر نسخة ناجحة يمنع شاشةً فارغة، لكنه يُظهر أرقاماً قديمة كأنها حيّة.
 * والوسم يجعل القِدَم مرئياً بدل أن يُخفيه اللطف.
 */
function stamp(d: FleetData, reason: string): FleetData {
  return { ...d, source: { ...d.source, stale: true, staleReason: reason } };
}

@Injectable()
export class FleetService {
  async getDashboard(refresh = false): Promise<FleetData> {
    if (!refresh && cache && Date.now() - cache.at < CACHE_MS) return cache.data;
    try {
      // لو الشيت مش عام، رابط التصدير بيرجّع صفحة HTML بـ 200 (مش خطأ HTTP) — فالتفسير هو اللي بيكشف ده.
      const res = await axios.get(EXPORT_URL, { responseType: 'arraybuffer', timeout: 30000 });
      const buf = Buffer.from(res.data);
      const wb = XLSX.read(buf, { type: 'buffer' });
      const monthlyWs = wb.Sheets['LookerMonthly'];
      const voyagesWs = wb.Sheets['LookerData'];
      const importLog = lastImport_(wb.Sheets['_ImportLog']);
      const m = monthlyWs ? parseMonthly(monthlyWs) : { ...EMPTY, missing: ['التبويب نفسه'] };
      const v = voyagesWs ? parseVoyages(voyagesWs) : { ...EMPTY, missing: ['التبويب نفسه'] };
      const monthly = m.rows as MonthRow[];
      const voyages = v.rows as VoyageRow[];
      if (!monthly.length) {
        // شيت فاضي أو اتغيّرت بنيته — ما نكسرش آخر كاش جيّد بنسخة فاضية
        if (cache) return stamp(cache.data, 'تعذّر تفسير التبويب — معروضٌ من آخر قراءة ناجحة');
        throw new Error('لم يتم العثور على بيانات في تبويب LookerMonthly (تأكد أن الشيت عام ومشارَك برابط)');
      }
      const vessels = [...new Set(monthly.map((x) => x.vessel))].sort();
      const months = [...new Set(monthly.map((x) => x.month))].sort();
      const now = new Date().toISOString();
      const data: FleetData = {
        vessels, months, monthly, voyages, generatedAt: now,
        source: {
          sheetId: SHEET_ID,
          sheetUrl: `https://docs.google.com/spreadsheets/d/${SHEET_ID}`,
          cacheMinutes: CACHE_MS / 60000,
          fetchedAt: now,
          stale: false,
          staleReason: null,
          lastImport: importLog,
          tabs: [
            { name: 'LookerMonthly', role: 'المصدر الأساسي — صف لكل مركب/شهر', found: !!monthlyWs,
              headerRow: m.headerRow, rows: monthly.length, columns: m.columns, missing: m.missing },
            { name: 'LookerData', role: 'التفصيل — صف لكل رحلة', found: !!voyagesWs,
              headerRow: v.headerRow, rows: voyages.length, columns: v.columns, missing: v.missing },
          ],
        },
      };
      cache = { data, at: Date.now() };
      return data;
    } catch (err: any) {
      // ارجع لآخر نسخة ناجحة عند أي فشل — لكن قُل إنها قديمة ولماذا
      if (cache) return stamp(cache.data, err?.message || 'تعذّر الجلب');
      throw new InternalServerErrorException('تعذّر تحميل بيانات الأسطول: ' + (err?.message || 'خطأ'));
    }
  }
}

// مكشوفة للاختبار وحده — مرجعية القراءة تُختبَر على عناوين حقيقية لا على وهم.
export const __test_parseMonthly = parseMonthly;
export const __test_parseVoyages = parseVoyages;
export const __test_lastImport = lastImport_;
