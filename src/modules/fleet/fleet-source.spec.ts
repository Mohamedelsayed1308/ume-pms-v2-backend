import * as XLSX from 'xlsx';
import { __test_parseMonthly, __test_parseVoyages } from './fleet.service';

/*
 * مرجعية القراءة تُوجد لسببٍ واحد: أن تغيير عنوانٍ في الشيت يُسقط عموده إلى صفر
 * بلا ضجيج. فالاختبار الحقيقي هنا ليس أن الخريطة تُبنى، بل أنها **تشتكي** حين
 * يختفي عنوان.
 */
function sheet(headers: string[], rows: any[][], name = 'LookerMonthly') {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([headers, ...rows]), name);
  return wb;
}
const FULL = ['المركب', 'الشهر', 'عدد الرحلات', 'اجمالي الصافي', 'الايراد',
  'المصاريف', 'السيولة', 'عدد الشاحنات', 'عدد المركبات', 'عدد الركاب'];
const ROW = ['ALCUDIA', 46023, 12, 500, 900, 400, 100, 30, 20, 80];

describe('مرجعية قراءة لوحة الأسطول', () => {
  it('تُطابق كل عمود وتُبلّغ حرفه', () => {
    const r = __test_parseMonthly(sheet(FULL, [ROW]).Sheets['LookerMonthly']);
    expect(r.missing).toEqual([]);
    expect(r.headerRow).toBe(1);
    const by = Object.fromEntries(r.columns.map((c) => [c.field, c.column]));
    expect(by.vessel).toBe('A');
    expect(by.month).toBe('B');
    expect(by.passengers).toBe('J');
  });

  it('تكشف العنوان المفقود بدل أن تُصفّره بصمت', () => {
    const broken = FULL.map((h) => (h === 'السيولة' ? 'Liquidity' : h));
    const r = __test_parseMonthly(sheet(broken, [ROW]).Sheets['LookerMonthly']);
    expect(r.missing).toContain('السيولة');
    expect(r.rows[0].liquidity).toBe(0);   // ‏الصفر ما زال يُقرأ — لكنه لم يعد صامتاً
    expect(r.rows[0].revenue).toBe(900);   // ‏وبقيّة الأعمدة سليمة
  });

  it('تُبلّغ عن غياب صف العناوين كلّه', () => {
    const r = __test_parseMonthly(sheet(['x', 'y'], [[1, 2]]).Sheets['LookerMonthly']);
    expect(r.headerRow).toBeNull();
    expect(r.missing).toContain('صف العناوين نفسه');
  });
});

/*
 * صفّ العناوين أدناه منسوخٌ حرفياً من تبويب `LookerData` في شيت الأسطول الحيّ.
 *
 * وفيه `REF` بحروف كبيرة، وكان البحث عن `ref` صغيرةً يُخفق فيسقط التبويب كلّه —
 * خمسمئة وسبعون صفاً — بلا خطأ ولا سجلّ. الاختبار يحرس الإصلاح بالعنوان الحقيقي
 * لا بعنوانٍ مُتخيَّل.
 */
const REAL_VOYAGE_HEADER = ['المركب', 'REF', 'التاريخ', 'الشهر', 'النوع',
  'عدد الشاحنات', 'عدد المركبات', 'عدد الركاب', 'الإيراد', 'العمولات',
  'المصاريف', 'الصافي', 'السيولة', 'بانكر', 'ميناء KSA', 'ميناء EGY'];
const REAL_VOYAGE_ROW = ['ALCUDIA', 1, 46023.667, 46023, 'قديمة', 268, 27, 17,
  123376.76, 22225.82, 60361.07, 40789.87, 0, 43136.29, 6199.36, 12753.15];

describe('مطابقة العناوين لا تبالي بحالة الأحرف', () => {
  it('تقرأ REF الكبيرة — العنوان الحقيقي من الشيت', () => {
    const ws = sheet(REAL_VOYAGE_HEADER, [REAL_VOYAGE_ROW], 'LookerData').Sheets['LookerData'];
    const r = __test_parseVoyages(ws);
    expect(r.headerRow).toBe(1);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].vessel).toBe('ALCUDIA');
    expect(r.rows[0].revenue).toBe(123376.76);
    expect(r.rows[0].bunker).toBe(43136.29);
    expect(r.missing).toEqual([]);
  });

  it('ولا تُصغّر اسم المركب في المخرجات', () => {
    const ws = sheet(REAL_VOYAGE_HEADER, [REAL_VOYAGE_ROW], 'LookerData').Sheets['LookerData'];
    expect(__test_parseVoyages(ws).rows[0].vessel).not.toBe('alcudia');
  });
});
