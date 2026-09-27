import * as XLSX from 'xlsx';
import { computeEntry } from './crew-salary.calc';
import { buildPaymentsWorkbook, buildReviewWorkbook, payableEntries, safeText, type Snapshot, type SnapshotEntry } from './crew-salary.export';

const entry = (over: Partial<SnapshotEntry>): SnapshotEntry => ({
  key: '1:EUR', crew_id: '0001', name: 'A', rank: 'AB', nationality: 'X', currency: 'EUR', section: 'monthly',
  result: computeEntry({ month: '2026-08', currency: 'EUR', payStart: '2026-08-01', payEnd: '2026-08-31', signsOffThisMonth: false, rates: { basic: '1000', fixed_ot: '0', leave: '0' }, extras: [] }, null),
  differences: [], differences_acknowledged: true,
  bank: { id: 'b', beneficiary: '=HYPERLINK("http://x")', beneficiary_is_seafarer: true, bank: 'B', branch: '', country: '', iban: 'BG00TEST00000000000001', account_number: '00123', swift: 'S', bank_code: '', national_id_last4: '', authorization: null },
  payable: true, blockers: [], ...over,
});

const snap = (entries: SnapshotEntry[]): Snapshot => ({ cycle: { id: 'c', vessel: 'V', month: '2026-08' }, entries, fx: null, files: [], decisions: [] });
const read = (b: Buffer) => XLSX.read(b, { type: 'buffer' });

describe('تصدير Excel', () => {
  it('حقن الصيغ: النصّ الذي يبدأ بـ = + - @ يُسبق بفاصلةٍ عليا', () => {
    for (const s of ['=1+1', '+1', '-1', '@x', '\tx']) expect(safeText(s).startsWith("'")).toBe(true);
    expect(safeText('Ahmed')).toBe('Ahmed');
  });

  it('كشف الصرف: الحالات المكتملة وحدها، والمعرّفات نصوص، ولا صيغة في الملفّ', () => {
    const s = snap([entry({}), entry({ key: '2:EUR', crew_id: '0002', payable: false, blockers: ['لا حساب صرف'], bank: null }), entry({ key: '3:USD', crew_id: '0003', currency: 'USD' })]);
    expect(payableEntries(s, 'EUR').included.map((e) => e.crew_id)).toEqual(['0001']);
    const out = buildPaymentsWorkbook(s, { batch_no: 'CS-V-202608-V1-EUR', currency: 'EUR', exported_at: '2026-09-27T00:00:00Z', version_no: 1, approved_by: 'M', approved_at: '2026-09-27' });
    expect(out.rows).toBe(1);
    expect(out.total).toBe('1000.00');
    const wb = read(out.buffer);
    const ws = wb.Sheets['الصرف'];
    const cells = Object.entries(ws).filter(([k]) => !k.startsWith('!')).map(([, c]) => c as XLSX.CellObject);
    expect(cells.some((c) => c.f)).toBe(false);
    const id = cells.find((c) => c.v === '0001');
    expect(id?.t).toBe('s');
    expect(cells.find((c) => String(c.v).includes('HYPERLINK'))!.v).toBe('\'=HYPERLINK("http://x")');
    expect(cells.some((c) => c.v === '00123' && c.t === 's')).toBe(true);
    // المستبعَد بسببه
    const ex = XLSX.utils.sheet_to_json<any[]>(wb.Sheets['مستبعَد'], { header: 1 });
    expect(ex[1]).toEqual(['0002', 'A', 1000, 'لا حساب صرف']);
  });

  it('كشف المراجعة: أوراقه الأربع', () => {
    const wb = read(buildReviewWorkbook(snap([entry({})]), { exported_at: 'x', status: 'draft', version_no: null }));
    expect(wb.SheetNames).toEqual(['معلومات', 'البنود', 'الفروق', 'الإجماليّات']);
  });
});
