import * as XLSX from 'xlsx';
import { computeEntry } from './crew-salary.calc';
import { buildPaymentsWorkbook, buildReviewWorkbook, payableEntries, safeText, type BatchResolution, type BatchRow, type PaymentContext, type Snapshot, type SnapshotEntry } from './crew-salary.export';

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

  // ── ما خرج ليس ما صُرف: الحالة التي خرجت ثمّ تغيّرت تنتظر قرار المالك، ولا خصم ولا إعادة آليّة ──
  const bal = (b: string) => ({ ...entry({}).result, balance: b });
  const out1 = (over: Partial<BatchRow> = {}): BatchRow => ({
    id: 'r1', batch_no: 'CS-V-202608-V1-EUR', version_no: 1, entry_key: '0001:EUR', crew_id: '0001', currency: 'EUR',
    amount: '1000.00', balance: '1000.00', entry_hash: 'h1', bank_id: 'b', row_kind: 'full', ...over,
  });
  const decided = (over: Partial<BatchResolution>): BatchResolution => ({ id: 'd1', row_id: 'r1', action: 'keep', amount: null, entry_hash: 'h2', reason: 'مستند', decided_by_name: 'Owner', ...over });
  const ctxOf = (rows: BatchRow[], resolutions: BatchResolution[] = []): PaymentContext => ({ superseded: new Map(), rows, resolutions });

  it('زيادةٌ بعد تصديرٍ لم يُنفَّذ: لا يُصرف الفرق آليّاً — تنتظر قرار المالك', () => {
    const s = snap([entry({ entry_hash: 'h2', result: bal('1100.00') } as any)]);
    const p = payableEntries(s, 'EUR', ctxOf([out1()]));
    expect(p.included).toEqual([]);
    expect(p.pending).toHaveLength(1);
    expect(p.pending[0]).toMatchObject({ exported: '1000.00 EUR', amount_changed: true, bank_changed: false, row: { id: 'r1' } });
    expect(p.excluded[0].reasons[0]).toMatch(/تنتظر قرار المالك/);
    // المالك: الملفّ السابق لم يُنفَّذ ⇒ يُستبدل ويخرج الصافي الجديد كاملاً
    const r = payableEntries(s, 'EUR', ctxOf([out1()], [decided({ action: 'replace' })]));
    expect(r.included.map((x) => [x.kind, x.due, x.replaces])).toEqual([['full', '1100.00', ['r1']]]);
    // المالك: نُفِّذ ⇒ تسويةٌ إضافيّة بمبلغٍ يحدّده صراحةً (لا الفرق المحسوب آليّاً)
    const t = payableEntries(s, 'EUR', ctxOf([out1()], [decided({ action: 'settle', amount: '100.00' })]));
    expect(t.included.map((x) => [x.kind, x.due, x.replaces])).toEqual([['settlement', '100.00', []]]);
    const wb = read(buildPaymentsWorkbook(s, { ...meta, version_no: 2 }, ctxOf([out1()], [decided({ action: 'settle', amount: '100.00' })])).buffer);
    const row = XLSX.utils.sheet_to_json<any[]>(wb.Sheets['الصرف'], { header: 1 }).find((x) => x[1] === '0001')!;
    expect([row[12], row[13], row[14], row[16]]).toEqual([1100, 1000, 'CS-V-202608-V1-EUR', 100]);
    expect(row[15]).toMatch(/تسوية إضافيّة بقرار المالك/);
  });

  it('تغيير الحساب وحده: لا يخرج المبلغ مرّةً ثانية — تنتظر قرار المالك', () => {
    const s = snap([entry({ entry_hash: 'h2', bank: { ...entry({}).bank!, id: 'b2', iban: 'BG00TEST00000000000002' } } as any)]);
    const p = payableEntries(s, 'EUR', ctxOf([out1()]));
    expect(p.included).toEqual([]);
    expect(p.pending[0]).toMatchObject({ amount_changed: false, bank_changed: true });
    expect(p.excluded[0].reasons[0]).toMatch(/\(الحساب\)/);
    const r = payableEntries(s, 'EUR', ctxOf([out1()], [decided({ action: 'replace' })]));
    expect(r.included.map((x) => [x.kind, x.due, x.entry.bank!.id])).toEqual([['full', '1000.00', 'b2']]);
  });

  it('نقصٌ بلا إثبات سداد: لا خصم آليّ ولا صفّ سالب — والإبقاء لا يُخرج شيئاً', () => {
    const s = snap([entry({ entry_hash: 'h2', result: bal('900.00') } as any)]);
    const p = payableEntries(s, 'EUR', ctxOf([out1()]));
    expect(p.included).toEqual([]);
    expect(p.pending[0]).toMatchObject({ amount_changed: true });
    expect(JSON.stringify(p)).not.toMatch(/-100|تُسترَدّ/);
    const k = payableEntries(s, 'EUR', ctxOf([out1()], [decided({ action: 'keep', reason: 'نُفِّذ بإيصال البنك' })]));
    expect(k.included).toEqual([]);
    expect(k.pending).toEqual([]);
    expect(k.excluded[0].reasons[0]).toMatch(/قرار المالك: يبقى ما خرج .* نُفِّذ بإيصال البنك/);
    const r = payableEntries(s, 'EUR', ctxOf([out1()], [decided({ action: 'replace' })]));
    expect(r.included.map((x) => [x.kind, x.due])).toEqual([['full', '900.00']]);
  });

  it('دفعةٌ جزئيّة A/B: ما لم يخرج فعلاً يخرج كاملاً — لقطة الإصدار ليست عضويّة الدفعة', () => {
    // V1: A مكتملة وخرجت، وB في اللقطة نفسها بلا حساب فلم تخرج
    const a = entry({ entry_hash: 'ha' } as any);
    const b1 = entry({ key: '0002:EUR', crew_id: '0002', entry_hash: 'hb1', payable: false, blockers: ['لا حساب صرف'], bank: null } as any);
    const v1 = payableEntries(snap([a, b1]), 'EUR', ctxOf([]));
    expect(v1.included.map((x) => x.entry.crew_id)).toEqual(['0001']);
    const rows = [out1({ entry_hash: 'ha' })]; // ما سُجِّل فعلاً: A وحدها
    // V2: B اكتملت (حسابٌ معتمد) — تخرج كاملةً، وA لا تُعاد
    const b2 = entry({ key: '0002:EUR', crew_id: '0002', entry_hash: 'hb2', result: bal('700.00') } as any);
    const v2 = payableEntries(snap([a, b2]), 'EUR', ctxOf(rows));
    expect(v2.included.map((x) => [x.entry.crew_id, x.kind, x.due])).toEqual([['0002', 'full', '700.00']]);
    expect(v2.excluded.map((x) => [x.entry.crew_id, x.reasons[0]])).toEqual([['0001', 'خرجت في CS-V-202608-V1-EUR — لا جديد']]);
    expect(v2.pending).toEqual([]);
  });

  it('قرارٌ لمحتوى سابق لا يسري على تعديلٍ لاحق', () => {
    const s = snap([entry({ entry_hash: 'h3', result: bal('1200.00') } as any)]);
    const p = payableEntries(s, 'EUR', ctxOf([out1()], [decided({ action: 'replace', entry_hash: 'h2' })]));
    expect(p.included).toEqual([]);
    expect(p.pending).toHaveLength(1);
  });

  it('تغيّر عملة الدفع بعد الخروج: لا تخرج بالعملة الجديدة كأنّها جديدة', () => {
    const usd = entry({ currency: 'USD', payment_currency_exception: true, entry_hash: 'h2', result: bal('1170.00') } as any);
    const p = payableEntries(snap([usd]), 'USD', ctxOf([out1()]));
    expect(p.included).toEqual([]);
    expect(p.pending[0]).toMatchObject({ exported: '1000.00 EUR' });
  });

  it('مفتاحٌ جديد لأنّ العملة تغيّرت: ما خرج تحت المفتاح الغائب يُعدّ خروجاً سابقاً', () => {
    const usd = entry({ key: '0001:USD', currency: 'USD', contract_currency: 'USD', entry_hash: 'hu' } as any);
    const gone = { ...ctxOf([out1()]), live: new Set(['0001:USD']) };
    const p = payableEntries(snap([usd]), 'USD', gone);
    expect(p.included).toEqual([]);
    expect(p.pending[0]).toMatchObject({ row: { id: 'r1' }, exported: '1000.00 EUR' });
    expect(p.excluded[0].reasons[0]).toMatch(/العملة: 0001:EUR ⇐ 0001:USD/);
    // والحالتان قائمتان معاً (مستحقٌّ بعملةٍ ثانية): الثانية مستقلّة وتخرج
    const both = payableEntries(snap([usd]), 'USD', { ...ctxOf([out1()]), live: new Set(['0001:USD', '0001:EUR']) });
    expect(both.included.map((x) => x.entry.key)).toEqual(['0001:USD']);
  });

  it('حالةٌ أُطفئ اعتمادها كلّه (حلّ محلّها بديل) لا تخرج من إصدارها القديم', () => {
    const e = entry({ entry_hash: 'h1' } as any);
    expect(payableEntries(snap([e]), 'EUR', { ...ctxOf([]), superseded: new Map([['0001:EUR', 2]]) }).excluded[0].reasons).toEqual(['حلّ محلّها الإصدار 2']);
    const p = payableEntries(snap([e]), 'EUR', { ...ctxOf([]), superseded: new Map([['0001:EUR', 0]]) });
    expect(p.included).toEqual([]);
    expect(p.excluded[0].reasons).toEqual(['لا اعتماد ساري لها']);
  });

  it('ما أُلغي بقرار المالك ولا صفّ ساريَ له لا يخرج تلقائيّاً', () => {
    const p = payableEntries(snap([entry({ entry_hash: 'h1' } as any)]), 'EUR', { ...ctxOf([]), replacedKeys: new Set(['0001:EUR']) });
    expect(p.included).toEqual([]);
    expect(p.excluded[0].reasons[0]).toMatch(/أُلغي ما خرج لها/);
  });

  it('بعد تسويةٍ: القرار التالي على آخر صفٍّ خرج (التسوية) لا على الأوّل', () => {
    const rows = [out1(), out1({ id: 'r2', batch_no: 'CS-V-202608-V2-EUR', row_kind: 'settlement', amount: '100.00', balance: '1100.00', entry_hash: 'h2' })];
    const s = snap([entry({ entry_hash: 'h3', result: bal('1150.00') } as any)]);
    const p = payableEntries(s, 'EUR', ctxOf(rows, [decided({ action: 'settle', amount: '50.00', entry_hash: 'h3' })]));
    expect(p.included).toEqual([]);
    expect(p.pending[0]).toMatchObject({ row: { id: 'r2' }, exported: '1100.00 EUR' });
    const q = payableEntries(s, 'EUR', ctxOf(rows, [decided({ row_id: 'r2', action: 'settle', amount: '50.00', entry_hash: 'h3' })]));
    expect(q.included.map((x) => [x.kind, x.due])).toEqual([['settlement', '50.00']]);
  });
  it('حالةٌ حلّ محلّها إصدارٌ أحدث لا تدخل كشف الإصدار القديم', () => {
    const s = snap([entry({})]);
    const p = payableEntries(s, 'EUR', { superseded: new Map([['0001:EUR', 3]]), rows: [], resolutions: [] });
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
