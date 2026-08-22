/**
 * انتقاء الرحلات من الشيت — الخطّ والمدى والسنة.
 *
 * ما يحرسه هذا الملفّ ليس حساباً بل **اختياراً**: أيّ صفوفٍ تدخل الفترة.
 * وهو خطأٌ لا يظهر في الأرقام بل في مصدرها، فلا يُكتشف بمراجعة النتيجة.
 *
 * الحالة التي استدعته: دليلة تُبحر على جدّة/سواكن منذ يناير ٢٠٢٦ وأرقام
 * رحلاتها تبدأ من ١ في كلّ خطّ. فمدىً بالرقم بلا قيد الخطّ التقط خمس رحلاتٍ
 * من الخطّ الآخر في نافذة ١٨–٣١ يوليو، فانقلبت القسمة من شريكين إلى ثلاثة
 * وتغيّر كلّ رقمٍ في الكشف. والمستند يعرض دليلة صفراً في تلك الفترة نفسها.
 */
import { ProfitPeriodsService, DISTRIBUTION_LINE } from './profit-periods.service';
import axios from 'axios';
import * as XLSX from 'xlsx';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

/** يبني مصنّفاً في الذاكرة بالشكل الذي يقرؤه الشيت: الحمولة في العمود ١١. */
function sheetOf(payloads: Record<string, unknown>[]): Buffer {
  const rows: unknown[][] = [
    ['المركب', 'الخطّ', 'REF', 'التاريخ', '', '', '', '', '', '', 'payload'],
    ...payloads.map((p) => [p.vessel, p.line, p.ref, p.dateExp, '', '', '', '', '', '', JSON.stringify(p)]),
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'DATA');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

/*
 * رحلةٌ صناعيّة بِرِجليها.
 *
 * الرِّجلان مقصودتان: تفصيل الرحلة يعرض «ذهاب / إياب» لكلّ بند، وقالبٌ بِرِجلٍ
 * واحدة يمرّ فوق خطأٍ في الجمع دون أن يكشفه.
 */
const voyage = (o: Record<string, unknown>) => ({
  year: 2026, income: 100000, comm: 5000, bnk: 20000, liq: 90000,
  trE: 60000, trI: 40000, nTruck_E: 100, nTruck_I: 95,
  vhE: 1000, vhI: 2000, nVeh_E: 5, nVeh_I: 8,
  pxE: 500, pxI: 700, nPax_E: 50, nPax_I: 60,
  man: 30000, net: 25000, cashDuba: 18000, cashSafaga: 7000,
  ...o,
});

/*
 * ثمانية صفوف: أربعة لبوسيدون وثلاثة لأمل على ضبا/سفاجا، وواحد لدليلة على
 * جدّة/سواكن يحمل رقماً يقع داخل مدى أمل — وهو الفخّ نفسه.
 */
const PAYLOADS = [
  voyage({ vessel: 'POSEIDON', line: 'ضبا/سفاجا', ref: 69, dateExp: '2026-07-19' }),
  voyage({ vessel: 'POSEIDON', line: 'ضبا/سفاجا', ref: 70, dateExp: '2026-07-22' }),
  voyage({ vessel: 'POSEIDON', line: 'ضبا/سفاجا', ref: 71, dateExp: '2026-07-26' }),
  voyage({ vessel: 'POSEIDON', line: 'ضبا/سفاجا', ref: 72, dateExp: '2026-07-29' }),
  voyage({ vessel: 'AMAL', line: 'ضبا/سفاجا', ref: 52, dateExp: '2026-07-18' }),
  voyage({ vessel: 'AMAL', line: 'ضبا/سفاجا', ref: 53, dateExp: '2026-07-21' }),
  voyage({ vessel: 'AMAL', line: 'ضبا/سفاجا', ref: 54, dateExp: '2026-07-24' }),
  voyage({ vessel: 'DALEELA', line: 'جدّة/سواكن', ref: 45, dateExp: '2026-07-20' }),
  voyage({ vessel: 'DALEELA', line: 'جدّة/سواكن', ref: 46, dateExp: '2026-07-25' }),
  // دليلة على الخطّ المعنيّ لكن في سنةٍ أخرى — السنة تحرسها لا الخطّ
  voyage({ vessel: 'DALEELA', line: 'ضبا/سفاجا', ref: 45, dateExp: '2025-07-20', year: 2025 }),
];

describe('fetchFromUnifiedSheet — انتقاء الرحلات', () => {
  let svc: ProfitPeriodsService;

  beforeEach(() => {
    svc = new ProfitPeriodsService({} as never);
    mockedAxios.get.mockResolvedValue({ data: sheetOf(PAYLOADS) });
  });

  it('يستبعد الخطّ الآخر ويُبلّغ بعدده', async () => {
    const out = await svc.fetchFromUnifiedSheet('2026-07-18', '2026-07-31');
    expect(out.daleela.voyages).toBe(0);
    expect(out.source.line).toBe(DISTRIBUTION_LINE);
    expect(out.source.offLine).toBeGreaterThan(0);
  });

  it('القيد يُميّز في الاتّجاهين — بخطّ جدّة/سواكن ينقلب الانتقاء', async () => {
    const out = await svc.fetchFromUnifiedSheet('2026-07-18', '2026-07-31', undefined, 'جدّة/سواكن');
    expect(out.daleela.voyages).toBe(2);
    expect(out.poseidon.voyages).toBe(0);
    expect(out.amal.voyages).toBe(0);
  });

  /*
   * خطٌّ فارغ لا يفتح الباب.
   *
   * لو عُطّل الحارس بقيمةٍ فارغة، لكفى حقلٌ لم يُملأ في نداءٍ واحد ليُدخل
   * مركباً من خطٍّ آخر في القسمة — وهو خطأٌ صامت لا يظهر إلا في مبلغ التوزيع.
   */
  it('الخطّ الفارغ يعود إلى الافتراضيّ ولا يُعطّل الحارس', async () => {
    for (const bad of ['', '   ', undefined, null as unknown as string]) {
      const out = await svc.fetchFromUnifiedSheet('2026-07-18', '2026-07-31', undefined, bad);
      expect(out.daleela.voyages).toBe(0);
      expect(out.source.line).toBe(DISTRIBUTION_LINE);
    }
  });

  it('المدى بالرقم لا يلتقط رقماً مطابقاً من خطٍّ آخر', async () => {
    const out = await svc.fetchFromUnifiedSheet('2026-07-18', '2026-07-31', {
      poseidon: { from: 69, to: 72 },
      amal: { from: 52, to: 56 },
      daleela: { from: 45, to: 49 },
    });
    expect(out.poseidon.voyages).toBe(4);
    expect(out.amal.voyages).toBe(3);
    expect(out.daleela.voyages).toBe(0);
  });

  it('يجمع أساس العمولة والوقود والسيولة لا الإيراد وحده', async () => {
    const out = await svc.fetchFromUnifiedSheet('2026-07-18', '2026-07-31', {
      poseidon: { from: 69, to: 72 },
    });
    expect(out.poseidon.sdBase).toBe(240000);   // ٤ × ٦٠٬٠٠٠
    expect(out.poseidon.bunker).toBe(80000);    // ٤ × ٢٠٬٠٠٠
    expect(out.poseidon.liquidity).toBe(360000); // ٤ × ٩٠٬٠٠٠
    expect(out.poseidon.revenue).toBe(400000);
  });

  it('نقصُ المدى يُرى ولا يُجمع بصمت', async () => {
    const out = await svc.fetchFromUnifiedSheet('2026-07-18', '2026-07-31', {
      amal: { from: 52, to: 56 },
    });
    expect(out.amal.expected).toBe(5);
    expect(out.amal.missing).toEqual([55, 56]);
  });

  it('الشدّة والمسافات لا تمنع مطابقة الخطّ', async () => {
    const out = await svc.fetchFromUnifiedSheet('2026-07-18', '2026-07-31', undefined, ' ضبا / سفاجا ');
    expect(out.poseidon.voyages).toBe(4);
  });

  it('رقم الرحلة يتكرّر كلّ سنة — فالسنة تدخل الانتقاء', async () => {
    const out = await svc.fetchFromUnifiedSheet('2026-07-18', '2026-07-31', {
      daleela: { from: 45, to: 49 },
    });
    expect(out.daleela.voyages).toBe(0);
  });

  /*
   * تفصيل الرحلات يُخزَّن مع الفترة لا يُجلَب عند العرض — لأنّ الدفتر يتغيّر.
   * فما يُخرجه الجلب يجب أن يجمع إلى المجاميع نفسها، وإلا عُرض كشفٌ لا يتّسق
   * مع توزيعه.
   */
  describe('تفصيل الرحلات', () => {
    it('صفٌّ لكلّ رحلة، مرتّباً بالرقم', async () => {
      const out = await svc.fetchFromUnifiedSheet('2026-07-18', '2026-07-31', {
        poseidon: { from: 69, to: 72 },
      });
      const rows = out.poseidon.voyageRows;
      expect(rows).toHaveLength(4);
      expect(rows.map((r: { ref: number }) => r.ref)).toEqual([69, 70, 71, 72]);
    });

    it('مجموع التفصيل يساوي مجاميع المركب — وإلا كذب أحدهما', async () => {
      const out = await svc.fetchFromUnifiedSheet('2026-07-18', '2026-07-31', {
        poseidon: { from: 69, to: 72 },
      });
      const rows = out.poseidon.voyageRows as Array<Record<string, number>>;
      const sum = (f: string) =>
        Math.round(rows.reduce((a, r) => a + r[f], 0) * 100) / 100;
      expect(sum('income')).toBe(out.poseidon.revenue);
      expect(sum('cashDuba')).toBe(out.poseidon.cashDuba);
      expect(sum('cashSafaga')).toBe(out.poseidon.cashSafaga);
      expect(sum('comm')).toBe(out.poseidon.commission);
    });

    it('الشاحنات والمركبات والركّاب مجموعةً بأعدادها', async () => {
      const out = await svc.fetchFromUnifiedSheet('2026-07-18', '2026-07-31', {
        poseidon: { from: 69, to: 72 },
      });
      const r = out.poseidon.voyageRows[0];
      // الدفتر الصناعيّ يضع trE=60000 · trI=40000 · nTruck_E=100 · nTruck_I=95
      expect(r.truck).toBe(100000);
      expect(r.nTruckE).toBe(100);
      expect(r.nTruckI).toBe(95);
    });

    it('لا تفصيل لمركبٍ خارج الفترة', async () => {
      const out = await svc.fetchFromUnifiedSheet('2026-07-18', '2026-07-31', {
        poseidon: { from: 69, to: 72 },
      });
      expect(out.daleela.voyageRows).toEqual([]);
    });
  });
});
