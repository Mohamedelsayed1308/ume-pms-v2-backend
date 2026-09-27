import * as XLSX from 'xlsx';
import { computeEntry } from './crew-salary.calc';
import { buildPaymentsWorkbook, buildReviewWorkbook, payableEntries, safeText, type Snapshot, type SnapshotEntry } from './crew-salary.export';

const entry = (over: Partial<SnapshotEntry>): SnapshotEntry => ({
  key: '0001:EUR', crew_id: '0001', name: 'A', rank: 'AB', nationality: 'X', currency: 'EUR', contract_currency: 'EUR', payment_currency_exception: false, section: 'monthly',
  result: computeEntry({ month: '2026-08', currency: 'EUR', payStart: '2026-08-01', payEnd: '2026-08-31', signsOffThisMonth: false, rates: { basic: '1000', fixed_ot: '0', leave: '0' }, extras: [] }, null),
  differences: [], source_conflicts: [], differences_acknowledged: true,
  bank: { id: 'b', beneficiary: '=HYPERLINK("http://x")', beneficiary_is_seafarer: true, bank: 'B', branch: '', country: '', iban: 'BG00TEST00000000000001', account_number: '00123', swift: 'S', bank_code: '', authorization: null },
  payable: true, blockers: [], ...over,
});

const snap = (entries: SnapshotEntry[], extra: Partial<Snapshot> = {}): Snapshot => ({ cycle: { id: 'c', vessel: 'V', month: '2026-08' }, entries, fx: null, ...extra });
const read = (b: Buffer) => XLSX.read(b, { type: 'buffer' });
const meta = { batch_no: 'CS-V-202608-V1-EUR', currency: 'EUR', exported_at: '2026-09-27T00:00:00Z', version_no: 1, approved_by: 'M', approved_at: '2026-09-27' };

describe('تصدير Excel', () => {
  it('حقن الصيغ: النصّ الذي يبدأ بـ = + - @ يُسبق بفاصلةٍ عليا', () => {
    for (const s of ['=1+1', '+1', '-1', '@x', '\tx']) expect(safeText(s).startsWith("'")).toBe(true);
    expect(safeText('Ahmed')).toBe('Ahmed');
  });

  it('كشف الصرف: الحالات المكتملة وحدها، والمعرّفات نصوص، ولا صيغة في الملفّ', () => {
    const s = snap([entry({}), entry({ key: '0002:EUR', crew_id: '0002', payable: false, blockers: ['لا حساب صرف'], bank: null }), entry({ key: '0003:USD', crew_id: '0003', currency: 'USD' })]);
    expect(payableEntries(s, 'EUR').included.map((r) => r.entry.crew_id)).toEqual(['0001']);
    const out = buildPaymentsWorkbook(s, meta);
    expect(out.rows).toBe(1);
    expect(out.total).toBe('1000.00');
    const wb = read(out.buffer);
    const cells = Object.entries(wb.Sheets['الصرف']).filter(([k]) => !k.startsWith('!')).map(([, c]) => c as XLSX.CellObject);
    expect(cells.some((c) => c.f)).toBe(false);
    expect(cells.find((c) => c.v === '0001')?.t).toBe('s');
    expect(cells.find((c) => String(c.v).includes('HYPERLINK'))!.v).toBe('\'=HYPERLINK("http://x")');
    expect(cells.some((c) => c.v === '00123' && c.t === 's')).toBe(true);
    const ex = XLSX.utils.sheet_to_json<any[]>(wb.Sheets['مستبعَد'], { header: 1 });
    expect(ex[1]).toEqual(['0002', 'A', 1000, 'لا حساب صرف']);
  });

  it('حالةٌ صُدِّرت ثمّ عُدِّلت: يُصرف الفرق وحده، والنقص لا يُصرف', () => {
    const up = entry({ result: { ...entry({}).result, balance: '1050.00' } });
    const s = snap([up, entry({ key: '0004:EUR', crew_id: '0004', result: { ...entry({}).result, balance: '900.00' } })]);
    const ctx = { superseded: new Map(), previous: new Map([['0001:EUR', { batch: 'CS-V-202608-V1-EUR', amount: '1000.00', version_no: 1 }], ['0004:EUR', { batch: 'CS-V-202608-V1-EUR', amount: '1000.00', version_no: 1 }]]) };
    const p = payableEntries(s, 'EUR', ctx);
    expect(p.included.map((r) => [r.entry.crew_id, r.due])).toEqual([['0001', '50.00']]);
    expect(p.excluded[0].reasons[0]).toMatch(/تُسترَدّ يدويّاً/);
    expect(buildPaymentsWorkbook(s, { ...meta, version_no: 2 }, ctx).total).toBe('50.00');
  });

  it('حالةٌ حلّ محلّها إصدارٌ أحدث لا تدخل كشف الإصدار القديم', () => {
    const s = snap([entry({})]);
    const p = payableEntries(s, 'EUR', { superseded: new Map([['0001:EUR', 3]]), previous: new Map() });
    expect(p.included).toEqual([]);
    expect(p.excluded[0].reasons).toEqual(['حلّ محلّها الإصدار 3']);
  });

  it('الدفعة الجزئيّة تُعلَن جزئيّة ولا تُفهم إجماليّاً للمركب', () => {
    const s = snap([entry({})], { excluded: [{ key: '0009:EUR', crew_id: '0009', currency: 'EUR', balance: '700.00', reasons: ['لا حساب صرف'] }] });
    const wb = read(buildPaymentsWorkbook(s, meta).buffer);
    const info = XLSX.utils.sheet_to_json<any[]>(wb.Sheets['الصرف'], { header: 1 });
    expect(info.find((r) => r[0] === 'النطاق')![1]).toMatch(/دفعةٌ جزئيّة/);
    const ex = XLSX.utils.sheet_to_json<any[]>(wb.Sheets['مستبعَد'], { header: 1 });
    expect(ex.some((r) => r[0] === '0009' && /خارج هذا الإصدار/.test(r[3]))).toBe(true);
  });

  it('الملفّ نفسه حرفيّاً لنفس المحتوى', () => {
    const s = snap([entry({})]);
    expect(buildPaymentsWorkbook(s, meta).buffer.equals(buildPaymentsWorkbook(s, meta).buffer)).toBe(true);
  });

  it('كشف المراجعة: أوراقه الخمس ومنها قضايا المصدر', () => {
    const wb = read(buildReviewWorkbook(snap([entry({})]), { exported_at: 'x', status: 'draft', version_no: null, unresolved: [{ key: 'email:note:p9', kind: 'note', detail: 'n', source: {}, resolution: null }] }));
    expect(wb.SheetNames).toEqual(['معلومات', 'البنود', 'الفروق والتعارضات', 'قضايا المصدر', 'الإجماليّات']);
  });
});
