import * as fs from 'fs';
import * as path from 'path';
import * as XLSX from 'xlsx';
import { randomUUID } from 'crypto';
import { Client } from 'pg';
import { DataSource } from 'typeorm';
import { freshDb } from '../../../test/pg/db';
import { ExchangeRate } from '../exchange-rates/exchange-rate.entity';
import { ExchangeRatesService } from '../exchange-rates/exchange-rates.service';
import type { ScreenAuthzService } from '../../common/screen-authz.service';
import { CREW_SALARY_ENTITIES, CrewSalaryExportRow, CrewSalaryVersion } from './crew-salary.entity';
import { CrewSalariesService, type Actor } from './crew-salaries.service';
import { fakeCfm, type FakeCrew } from './crew-salary.fixture';

/*
 * الدفعات على PostgreSQL حقيقيّة مؤقّتة — ببياناتٍ اصطناعيّة:
 *   • «خرج» ليس «صُرف»: الحالة التي خرجت ثمّ تغيّرت تنتظر قرار المالك، بلا خصمٍ ولا إعادةٍ آليّة.
 *   • عضويّة الدفعة صفوفٌ مسجَّلة، لا لقطة الإصدار.
 *   • التزامن: التصدير والاعتماد، وبطاقة الأسعار القديمة والاعتماد — بترتيبٍ مفروضٍ بقفلٍ ممسوك.
 */
const UP = fs.readFileSync(path.join(__dirname, '../../../docs/crew-salaries-up.sql'), 'utf8');
const APPROVER: Actor = { id: randomUUID(), email: 'approver@test.local', full_name: 'Owner' };
const CLERK: Actor = { id: randomUUID(), email: 'clerk@test.local', full_name: 'Clerk', role: 'admin' };
const FINANCE: Actor = { id: randomUUID(), email: 'finance@test.local', full_name: 'Finance' };
const authz = { can: async (id: string, href: string) => href === '/dashboard/reports' && id === FINANCE.id } as unknown as ScreenAuthzService;
const crew = (id: string): FakeCrew => ({ id, name: `Crew ${id}, Test`, rank: 'AB', section: 'monthly', start: 1, end: 31, rates: [1000, 400, 250] });

describe('دفعات مرتّبات الأطقم على PostgreSQL', () => {
  let db: Awaited<ReturnType<typeof freshDb>>;
  let ds: DataSource;
  let svc: CrewSalariesService;
  let rates: ExchangeRatesService;
  const env = process.env.CREW_SALARY_APPROVER_USER_ID;

  const view = (id: string): Promise<any> => svc.view(id, CLERK);
  const entry = async (id: string, crewId: string) => (await view(id)).entries.find((e: any) => e.crew_id === crewId);
  const latest = async (id: string) => (await view(id)).versions[0];
  const ack = async (id: string, crewId: string) => {
    const e = await entry(id, crewId);
    if (e.diff_hash && !e.differences_acknowledged) await svc.decide(id, { kind: 'difference_ack', target_key: e.key, hash: e.diff_hash, reason: 'تصحيحٌ موثَّق' }, CLERK);
  };
  const bank = async (id: string, crewId: string, n = 1) => {
    const acc = await svc.addBankAccount({ crew_id: crewId, beneficiary: `Crew ${crewId}`, bank: 'Test Bank', iban: `XX00TEST${crewId}${String(n).padStart(8, '0')}`, reason: 'صفحة الحساب' }, CLERK, id);
    await svc.reviewBankAccount(acc.id, { decision: 'approved', beneficiary_is_seafarer: true, reason: 'مطابق' }, APPROVER, id);
    return acc.id as string;
  };
  const setBasic = async (id: string, crewId: string, v: string) => {
    await svc.decide(id, { kind: 'field_override', target_key: `${crewId}:EUR|basic`, value: v, reason: 'تعديلٌ موثَّق' }, CLERK);
    await ack(id, crewId);
  };
  const submitApprove = async (id: string, note: string) => {
    await svc.submit(id, note, CLERK);
    const v = await latest(id);
    await svc.approve(v.id, `اعتماد ${note}`, APPROVER);
    return v;
  };
  /** قرار المالك على الحالة كما عرضتها اللوحة — بصمتها وإصدارها. */
  const exp = (d: any) => ({ kind: 'batch_resolution', row_id: d.row_id, expected_hash: d.entry_hash, expected_version_id: d.version_id });
  const cycleWith = async (vessel: string, crews: FakeCrew[], month?: { y: number; m: number; name: string }) => (await svc.importFile(fakeCfm(vessel, 'EUR', crews, month), `${vessel}.xlsx`, CLERK) as any).cycle_id as string;
  const sheetRows = (buf: Buffer) => XLSX.utils.sheet_to_json<any[]>(XLSX.read(buf, { type: 'buffer' }).Sheets['الصرف'], { header: 1 }).filter((r) => typeof r[0] === 'number');
  const rowsOf = (cycleId: string) => ds.getRepository(CrewSalaryExportRow).find({ where: { cycle_id: cycleId }, order: { created_at: 'ASC' } });
  /** ما خرج سارياً لكلّ حالة — مجموعاً بالعملة. */
  const activeOut = async (cycleId: string) => Object.fromEntries((await ds.query(
    `SELECT entry_key, sum(amount)::text s FROM crew_salary_export_rows WHERE cycle_id = $1 AND status = 'active' GROUP BY entry_key`, [cycleId])).map((r: any) => [r.entry_key, r.s]));

  /** قفلٌ ممسوك من اتّصالٍ آخر — يفرض ترتيب وصول العمليّات إلى القفل نفسه. */
  const hold = async (key: string) => {
    const c = new Client({ connectionString: db.url });
    await c.connect();
    await c.query('BEGIN');
    await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [key]);
    return { release: async () => { await c.query('COMMIT'); await c.end(); } };
  };
  const waiters = async () => Number((await ds.query(`SELECT count(*)::int n FROM pg_locks WHERE locktype = 'advisory' AND NOT granted`))[0].n);
  const untilWaiters = async (n: number) => {
    for (let i = 0; i < 200; i++) { if ((await waiters()) >= n) return; await new Promise((r) => setTimeout(r, 50)); }
    throw new Error(`لم يصل ${n} منتظرين إلى القفل`);
  };
  /** يعيد وعداً ومعه علمٌ بانتهائه — لإثبات أنّ عمليّةً ما زالت معلّقةً خلف القفل. */
  const track = <T>(p: Promise<T>) => {
    const t = { done: false, p: p.then((v) => { t.done = true; return v; }, (e) => { t.done = true; throw e; }) };
    return t;
  };

  beforeAll(async () => {
    db = await freshDb('crew_batches');
    ds = new DataSource({ type: 'postgres', url: db.url, entities: [...CREW_SALARY_ENTITIES, ExchangeRate], synchronize: false, extra: { max: 20 } });
    await ds.initialize();
    await ds.query(UP);
    await ds.query(`CREATE TABLE exchange_rates (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), month varchar UNIQUE NOT NULL, rates jsonb, updated_at timestamp NOT NULL DEFAULT now())`);
    rates = new ExchangeRatesService(ds.getRepository(ExchangeRate));
    svc = new CrewSalariesService(ds, rates, authz);
    process.env.CREW_SALARY_APPROVER_USER_ID = APPROVER.id;
  });
  afterAll(async () => {
    if (env === undefined) delete process.env.CREW_SALARY_APPROVER_USER_ID; else process.env.CREW_SALARY_APPROVER_USER_ID = env;
    await ds?.destroy(); await db?.drop();
  });

  // ══════════════ «خرج» ليس «صُرف» ══════════════
  it('زيادةٌ بعد تصديرٍ لم يُنفَّذ: لا فرق آليّ — قرار المالك «استبدال» يُخرج الجديد كاملاً ويُلغي القديم', async () => {
    const id = await cycleWith('Batch Up', [crew('9601')]);
    await bank(id, '9601');
    await submitApprove(id, 'الأوّل');
    const b1 = await svc.exportPayments(id, 'EUR', CLERK);
    expect(sheetRows(b1.buffer).map((r) => [r[1], r[16]])).toEqual([['9601', 1650]]);
    await setBasic(id, '9601', '1100');
    await submitApprove(id, 'الزيادة');
    // لا دفعة: الحالة الوحيدة خرجت ثمّ تغيّرت، ولا يُعرف أنُفِّذ ما خرج
    await expect(svc.exportPayments(id, 'EUR', CLERK)).rejects.toThrow(/تنتظر قرار المالك/);
    const pend = (await view(id)).batch_decisions;
    expect(pend).toHaveLength(1);
    expect(pend[0]).toMatchObject({ state: 'pending', crew_id: '9601', balance: '1750.00', amount_changed: true, bank_changed: false, prior: [{ amount: '1650.00', batch_no: 'CS-BATCHUP-202608-V1-EUR' }] });
    // الموظّف لا يقرّر، ولا قرار بلا سبب
    await expect(svc.decide(id, { ...exp(pend[0]), action: 'replace', reason: 'لم يُنفَّذ' }, CLERK)).rejects.toThrow(/وحده/);
    await expect(svc.decide(id, { ...exp(pend[0]), action: 'replace', reason: '' }, APPROVER)).rejects.toThrow(/لم تُنفَّذ/);
    await svc.decide(id, { ...exp(pend[0]), action: 'replace', reason: 'البنك أكّد أنّ الملفّ لم يُرفع' }, APPROVER);
    expect((await view(id)).batch_decisions[0]).toMatchObject({ state: 'decided', amount_changed: true, bank_changed: false, resolution: { action: 'replace' } });
    const b2 = await svc.exportPayments(id, 'EUR', CLERK);
    expect(b2.filename).toBe('CS-BATCHUP-202608-V2-EUR.xlsx');
    const r = sheetRows(b2.buffer)[0];
    expect([r[1], r[12], r[13], r[16]]).toEqual(['9601', 1750, 1650, 1750]);
    expect(r[15]).toMatch(/استبدال بقرار المالك/);
    const rows = await rowsOf(id);
    expect(rows.map((x) => [x.amount, x.row_kind, x.status])).toEqual([['1650.00', 'full', 'replaced'], ['1750.00', 'full', 'active']]);
    expect(rows[0].replaced_by).toBe(rows[1].id);
    expect(rows[1].resolution_id).toBeTruthy();
    expect(await activeOut(id)).toEqual({ '9601:EUR': '1750.00' });
    // الملفّ الأوّل يُنزَّل كما خرج حرفيّاً، ولا يُستهلك القرار مرّتين
    const v1 = (await view(id)).versions.find((v: any) => v.version_no === 1);
    expect((await svc.exportPayments(id, 'EUR', CLERK, v1.id)).buffer.equals(b1.buffer)).toBe(true);
    expect(await svc.exportPayments(id, 'EUR', CLERK)).toMatchObject({ redownload: true, filename: b2.filename });
    expect((await view(id)).batch_decisions).toEqual([]);
  });

  it('زيادةٌ بعد تصديرٍ نُفِّذ: «تسوية» بمبلغٍ يحدّده المالك صراحةً — لا يتجاوز الصافي', async () => {
    const id = await cycleWith('Batch Settle', [crew('9611')]);
    await bank(id, '9611');
    await submitApprove(id, 'الأوّل');
    await svc.exportPayments(id, 'EUR', CLERK);
    await setBasic(id, '9611', '1100');
    await submitApprove(id, 'الزيادة');
    const row = (await view(id)).batch_decisions[0];
    await expect(svc.decide(id, { ...exp(row), action: 'settle', amount: '-100', reason: 'فرق' }, APPROVER)).rejects.toThrow(/رقمٌ موجب/);
    await expect(svc.decide(id, { ...exp(row), action: 'settle', amount: '1750.01', reason: 'فرق' }, APPROVER)).rejects.toThrow(/لا تتجاوز/);
    await svc.decide(id, { ...exp(row), action: 'settle', amount: '100', reason: 'نُفِّذ الأوّل — إيصال البنك ١٢' }, APPROVER);
    const x = await svc.exportPayments(id, 'EUR', CLERK);
    expect(sheetRows(x.buffer).map((r) => [r[1], r[16]])).toEqual([['9611', 100]]);
    expect((await rowsOf(id)).map((r) => [r.amount, r.row_kind, r.status])).toEqual([['1650.00', 'full', 'active'], ['100.00', 'settlement', 'active']]);
  });

  it('تغيير الحساب وحده: لا يخرج المبلغ مرّةً ثانية آليّاً — «إبقاء» لا يُخرج شيئاً، و«استبدال» يُخرجه للحساب الجديد', async () => {
    const id = await cycleWith('Batch Bank', [crew('9602')]);
    const oldAcc = await bank(id, '9602', 1);
    await submitApprove(id, 'الأوّل');
    await svc.exportPayments(id, 'EUR', CLERK);
    const newAcc = await bank(id, '9602', 2);
    expect((await entry(id, '9602')).approval.changed).toBe(true);
    await submitApprove(id, 'الحساب الجديد');
    await expect(svc.exportPayments(id, 'EUR', CLERK)).rejects.toThrow(/تنتظر قرار المالك/);
    const p = (await view(id)).batch_decisions[0];
    expect(p).toMatchObject({ amount_changed: false, bank_changed: true });
    await svc.decide(id, { ...exp(p), action: 'keep', reason: 'نُفِّذ على الحساب القديم' }, APPROVER);
    await expect(svc.exportPayments(id, 'EUR', CLERK)).rejects.toThrow(/لا حالات مكتملة بمستحقٍّ جديد/);
    expect((await view(id)).batch_decisions[0]).toMatchObject({ state: 'kept', amount_changed: false, bank_changed: true });
    // ثمّ تبيّن أنّ الملفّ لم يُنفَّذ: القرار يُستبدل قبل الخروج
    await svc.decide(id, { ...exp(p), action: 'replace', reason: 'رُدّ الملفّ من البنك' }, APPROVER);
    await svc.exportPayments(id, 'EUR', CLERK);
    const rows = await rowsOf(id);
    expect(rows.map((r) => [r.bank_id, r.amount, r.status])).toEqual([[oldAcc, '1650.00', 'replaced'], [newAcc, '1650.00', 'active']]);
  });

  it('نقصٌ بلا إثبات سداد: لا خصم ولا صفّ سالب ولا إعادة — والصفّ الذي خرج يبقى كما هو', async () => {
    const id = await cycleWith('Batch Down', [crew('9603')]);
    await bank(id, '9603');
    await submitApprove(id, 'الأوّل');
    await svc.exportPayments(id, 'EUR', CLERK);
    await setBasic(id, '9603', '900');
    await submitApprove(id, 'النقص');
    await expect(svc.exportPayments(id, 'EUR', CLERK)).rejects.toThrow(/تنتظر قرار المالك/);
    const p = (await view(id)).batch_decisions[0];
    expect(p).toMatchObject({ balance: '1550.00', amount_changed: true, prior: [{ amount: '1650.00' }] });
    await svc.decide(id, { ...exp(p), action: 'keep', reason: 'الزيادة المصروفة تُعالَج خارج الشاشة' }, APPROVER);
    await expect(svc.exportPayments(id, 'EUR', CLERK)).rejects.toThrow(/لا حالات مكتملة/);
    expect((await rowsOf(id)).map((r) => [r.amount, r.status])).toEqual([['1650.00', 'active']]);
    expect(Number((await ds.query(`SELECT count(*)::int n FROM crew_salary_export_rows WHERE amount <= 0`))[0].n)).toBe(0);
  });

  it('A/B جزئيّ: B كانت في لقطة الإصدار الأوّل ولم تخرج — تخرج كاملةً لاحقاً، وA لا تُعاد', async () => {
    const id = await cycleWith('Batch AB', [crew('9604'), crew('9605')]);
    await bank(id, '9604');
    const v1 = await submitApprove(id, 'A وB بلا حساب');
    expect(v1.entries).toBe(2); // كلتاهما في لقطة V1
    const x1 = await svc.exportPayments(id, 'EUR', CLERK);
    expect(sheetRows(x1.buffer).map((r) => r[1])).toEqual(['9604']);
    expect((await rowsOf(id)).map((r) => r.crew_id)).toEqual(['9604']);
    await bank(id, '9605');
    const v2 = await submitApprove(id, 'حساب B');
    expect(v2.entries).toBe(1);
    const x2 = await svc.exportPayments(id, 'EUR', CLERK);
    expect(sheetRows(x2.buffer).map((r) => [r[1], r[13], r[16]])).toEqual([['9605', '', 1650]]);
    expect(await activeOut(id)).toEqual({ '9604:EUR': '1650.00', '9605:EUR': '1650.00' });
    // تعديل A بعد ذلك: A وحدها تنتظر قراراً، وB لا تُمسّ
    await setBasic(id, '9604', '1050');
    await submitApprove(id, 'تعديل A');
    const pend = (await view(id)).batch_decisions;
    expect(pend.map((p: any) => p.crew_id)).toEqual(['9604']);
  });

  it('دفعةٌ تالية للإصدار نفسه: ما قُرِّر بعد الدفعة الأولى يخرج في دفعةٍ برقمٍ تالٍ لا تكرّر ما خرج', async () => {
    const id = await cycleWith('Batch Seq', [crew('9606'), crew('9607')]);
    await bank(id, '9606'); await bank(id, '9607');
    await submitApprove(id, 'الأوّل');
    await svc.exportPayments(id, 'EUR', CLERK);
    await setBasic(id, '9606', '1100');
    await bank(id, '9607', 2);
    await submitApprove(id, 'تعديلان');
    const [a, b] = (await view(id)).batch_decisions.sort((x: any, y: any) => x.crew_id.localeCompare(y.crew_id));
    await svc.decide(id, { ...exp(a), action: 'replace', reason: 'لم يُنفَّذ' }, APPROVER);
    const x = await svc.exportPayments(id, 'EUR', CLERK);
    expect(x.pending).toBe(1);
    expect(sheetRows(x.buffer).map((r) => r[1])).toEqual(['9606']);
    await svc.decide(id, { ...exp(b), action: 'replace', reason: 'لم يُنفَّذ' }, APPROVER);
    const y = await svc.exportPayments(id, 'EUR', CLERK);
    expect(y.filename).toBe('CS-BATCHSEQ-202608-V2-EUR-B2.xlsx');
    expect(sheetRows(y.buffer).map((r) => r[1])).toEqual(['9607']);
    const batches = (await view(id)).exports.filter((e: any) => e.kind === 'approved_payments' && !e.is_redownload);
    const again = await svc.downloadExport(batches.find((e: any) => e.batch_no.endsWith('V2-EUR')).id, CLERK);
    expect(again.buffer.equals(x.buffer)).toBe(true);
  });

  it('تغيّر عملة الحالة بعد خروجها (مفتاحٌ جديد): لا تخرج كاملةً مرّةً ثانية — قرار المالك على الصفّ القديم', async () => {
    const r: any = await svc.importFile(fakeCfm('Batch Ccy', 'EUR', [crew('9641')]), 'ccy-eur.xlsx', CLERK);
    const id = r.cycle_id as string;
    await bank(id, '9641');
    await submitApprove(id, 'الأوّل');
    await svc.exportPayments(id, 'EUR', CLERK);
    // تصديرٌ مصحَّح بعملةٍ أخرى يحلّ محلّ الأوّل: الحالة صارت 9641:USD
    await svc.importFile(fakeCfm('Batch Ccy', 'USD', [crew('9641')]), 'ccy-usd.xlsx', CLERK, { replaces: r.file.id, reason: 'العقد بالدولار' });
    expect((await view(id)).entries.map((e: any) => e.key)).toEqual(['9641:USD']);
    await ack(id, '9641');
    await submitApprove(id, 'بالدولار');
    await expect(svc.exportPayments(id, 'USD', CLERK)).rejects.toThrow(/تنتظر قرار المالك/);
    const [p] = (await view(id)).batch_decisions;
    expect(p).toMatchObject({ state: 'pending', entry_key: '9641:USD', prior: [{ currency: 'EUR', amount: '1650.00' }] });
    // القرار على الحالة الجديدة وحدها، لا على حالةٍ قائمة لبحّارٍ آخر
    await expect(svc.decide(id, { ...exp(p), entry_key: '9999:USD', action: 'replace', reason: 'لم يُنفَّذ' }, APPROVER)).rejects.toThrow(/لبحّارٍ آخر/);
    await svc.decide(id, { ...exp(p), entry_key: p.entry_key, action: 'replace', reason: 'رُدّ ملفّ اليورو' }, APPROVER);
    const x = await svc.exportPayments(id, 'USD', CLERK);
    expect(sheetRows(x.buffer).map((row) => [row[1], row[16]])).toEqual([['9641', 1650]]);
    expect((await rowsOf(id)).map((row) => [row.entry_key, row.status])).toEqual([['9641:EUR', 'replaced'], ['9641:USD', 'active']]);
    // والإصدار الأوّل لا يُخرج اليورو من جديد
    const v1 = (await view(id)).versions.find((v: any) => v.version_no === 1);
    expect(await svc.exportPayments(id, 'EUR', CLERK, v1.id)).toMatchObject({ redownload: true });
    expect(await activeOut(id)).toEqual({ '9641:USD': '1650.00' });
  });

  it('استبدالٌ والصافي الجديد صفر: يُلغى ما خرج فوراً بقرار المالك، ولا صفّ بديل', async () => {
    const id = await cycleWith('Batch Zero', [crew('9642')]);
    await bank(id, '9642');
    await submitApprove(id, 'الأوّل');
    await svc.exportPayments(id, 'EUR', CLERK);
    for (const f of ['basic', 'fixed_ot', 'leave']) await svc.decide(id, { kind: 'field_override', target_key: `9642:EUR|${f}`, value: '0', reason: 'لم يعمل هذا الشهر' }, CLERK);
    await ack(id, '9642');
    await submitApprove(id, 'صفر');
    const [p] = (await view(id)).batch_decisions;
    expect(p).toMatchObject({ state: 'pending', balance: '0.00' });
    const d: any = await svc.decide(id, { ...exp(p), action: 'replace', reason: 'الملفّ لم يُرفع للبنك' }, APPROVER);
    const rows = await rowsOf(id);
    expect(rows.map((row) => [row.status, row.replaced_by])).toEqual([['replaced', d.id]]);
    await expect(svc.exportPayments(id, 'EUR', CLERK)).rejects.toThrow(/لا حالات مكتملة/);
    expect(await activeOut(id)).toEqual({});
  });

  // ══════════════ تصحيح العملة قبل أيّ تصدير: البديل يحلّ محلّ الأصل ══════════════
  /** دورةٌ اعتُمدت فيها حالة 9701 باليورو، ثمّ صُحّح العقد إلى الدولار (المفتاح صار 9701:USD) وقُدّم. */
  const ccySetup = async (vessel: string, crewId: string) => {
    const r: any = await svc.importFile(fakeCfm(vessel, 'EUR', [crew(crewId)]), `${vessel}-eur.xlsx`, CLERK);
    const id = r.cycle_id as string;
    await bank(id, crewId);
    const v1 = await submitApprove(id, 'اليورو');
    await svc.importFile(fakeCfm(vessel, 'USD', [crew(crewId)]), `${vessel}-usd.xlsx`, CLERK, { replaces: r.file.id, reason: 'العقد بالدولار' });
    await ack(id, crewId);
    await svc.submit(id, 'الدولار', CLERK);
    const v2 = await latest(id);
    return { id, v1, v2 };
  };

  it('تصحيح العملة: الدولار يُعتمد ويُصدَّر ثمّ يُطلب اليورو القديم أوّل مرّة — يُرفض، ولا صفّ لليورو', async () => {
    const { id, v1, v2 } = await ccySetup('Ccy First', '9701');
    await svc.approve(v2.id, 'اعتماد الدولار', APPROVER);
    const x = await svc.exportPayments(id, 'USD', CLERK);
    expect(sheetRows(x.buffer).map((r) => [r[1], r[16]])).toEqual([['9701', 1650]]);
    await expect(svc.exportPayments(id, 'EUR', CLERK, v1.id)).rejects.toThrow(/حلّ محلّ هذا الإصدار/);
    expect(await activeOut(id)).toEqual({ '9701:USD': '1650.00' });
    expect((await view(id)).versions.map((v: any) => [v.version_no, v.status])).toEqual([[2, 'approved'], [1, 'superseded']]);
    expect(Number((await ds.query(`SELECT count(*)::int n FROM crew_salary_entitlements WHERE cycle_id = $1 AND entry_key = '9701:EUR' AND active`, [id]))[0].n)).toBe(0);
    const snap = (await ds.getRepository(CrewSalaryVersion).findOne({ where: { id: v2.id } }))!.snapshot;
    expect(snap.entries.map((e: any) => [e.key, e.replaces_keys])).toEqual([['9701:USD', ['9701:EUR']]]); // علاقة الاستبدال صريحةٌ في اللقطة
  });

  it('تصحيح العملة: طلب اليورو القديم بعد اعتماد الدولار وقبل تصديره — يُرفض، والدولار يخرج مرّةً واحدة', async () => {
    const { id, v1, v2 } = await ccySetup('Ccy Second', '9702');
    await svc.approve(v2.id, 'اعتماد الدولار', APPROVER);
    await expect(svc.exportPayments(id, 'EUR', CLERK, v1.id)).rejects.toThrow(/حلّ محلّ هذا الإصدار/);
    expect(await rowsOf(id)).toEqual([]);
    const x = await svc.exportPayments(id, 'USD', CLERK);
    expect(sheetRows(x.buffer).map((r) => [r[1], r[16]])).toEqual([['9702', 1650]]);
    expect(await activeOut(id)).toEqual({ '9702:USD': '1650.00' });
  });

  it('تصحيح عملة حالةٍ في إصدارٍ جزئيّ: الحالة الأخرى تبقى معتمدةً وتخرج من إصدارها', async () => {
    const r: any = await svc.importFile(fakeCfm('Ccy Partial', 'EUR', [crew('9721'), crew('9722')]), 'cp-eur.xlsx', CLERK);
    const id = r.cycle_id as string;
    await bank(id, '9721'); await bank(id, '9722');
    const v1 = await submitApprove(id, 'الاثنان باليورو');
    // 9721 صار بالدولار، و9722 باقٍ باليورو كما هو
    await svc.importFile(fakeCfm('Ccy Partial', 'USD', [crew('9721')]), 'cp-usd.xlsx', CLERK);
    await svc.importFile(fakeCfm('Ccy Partial', 'EUR', [crew('9722')]), 'cp-eur-2.xlsx', CLERK, { replaces: r.file.id, reason: '9721 انتقل إلى عقدٍ بالدولار' });
    expect((await view(id)).entries.map((e: any) => e.key).sort()).toEqual(['9721:USD', '9722:EUR']);
    expect((await entry(id, '9722')).approval).toMatchObject({ changed: false, version_no: 1 });
    await ack(id, '9721');
    const v2 = await submitApprove(id, '9721 بالدولار');
    expect(v2.entries).toBe(1);
    expect((await view(id)).versions.find((v: any) => v.version_no === 1).status).toBe('approved'); // 9722 ما زال عليه
    const eur = await svc.exportPayments(id, 'EUR', CLERK, v1.id);
    expect(sheetRows(eur.buffer).map((x) => x[1])).toEqual(['9722']);
    const ex = XLSX.utils.sheet_to_json<any[]>(XLSX.read(eur.buffer, { type: 'buffer' }).Sheets['مستبعَد'], { header: 1 });
    expect(ex.some((x) => x[0] === '9721' && /حلّ محلّها الإصدار 2/.test(x[3]))).toBe(true);
    const usd = await svc.exportPayments(id, 'USD', CLERK);
    expect(sheetRows(usd.buffer).map((x) => [x[1], x[16]])).toEqual([['9721', 1650]]);
    expect(await activeOut(id)).toEqual({ '9721:USD': '1650.00', '9722:EUR': '1650.00' });
  });

  it('حالتان قائمتان للبحّار نفسه بعملتين لا تُدمجان: اعتماد إحداهما لا يطفئ الأخرى', async () => {
    const r: any = await svc.importFile(fakeCfm('Two Ccy', 'EUR', [crew('9731')]), 'tc-eur.xlsx', CLERK);
    const id = r.cycle_id as string;
    await svc.importFile(fakeCfm('Two Ccy', 'USD', [crew('9731')]), 'tc-usd.xlsx', CLERK);
    await bank(id, '9731');
    expect((await view(id)).entries.map((e: any) => e.key).sort()).toEqual(['9731:EUR', '9731:USD']);
    await svc.submit(id, 'اليورو وحده', CLERK, ['9731:EUR']);
    const v1 = await latest(id);
    await svc.approve(v1.id, 'اعتماد', APPROVER);
    await svc.submit(id, 'الدولار', CLERK, ['9731:USD']);
    const v2 = await latest(id);
    expect((await ds.getRepository(CrewSalaryVersion).findOne({ where: { id: v2.id } }))!.snapshot.entries[0].replaces_keys).toBeUndefined();
    await svc.approve(v2.id, 'اعتماد', APPROVER);
    expect(sheetRows((await svc.exportPayments(id, 'EUR', CLERK, v1.id)).buffer).map((x) => x[1])).toEqual(['9731']);
    expect(sheetRows((await svc.exportPayments(id, 'USD', CLERK, v2.id)).buffer).map((x) => x[1])).toEqual(['9731']);
  });

  // ══════════════ قرار المالك من صفحةٍ قديمة ══════════════
  it('قرارٌ فُتح على V2 (1,750) ووصل بعد اعتماد V3 (2,450): يُرفض 409 لكلّ فعل، بلا قرارٍ ولا تصدير — ثمّ يُعاد على V3', async () => {
    const id = await cycleWith('Stale Owner', [crew('9751')]);
    await bank(id, '9751');
    await submitApprove(id, 'الأوّل');
    await svc.exportPayments(id, 'EUR', CLERK);
    await setBasic(id, '9751', '1100');
    await submitApprove(id, 'الإصدار ٢');
    const d2 = (await view(id)).batch_decisions[0];
    expect(d2).toMatchObject({ version_no: 2, balance: '1750.00' });
    await setBasic(id, '9751', '1800');
    await submitApprove(id, 'الإصدار ٣');
    const count = async () => Number((await ds.query(`SELECT count(*)::int n FROM crew_salary_decisions WHERE cycle_id = $1 AND kind = 'batch_resolution'`, [id]))[0].n);
    for (const body of [{ action: 'replace' }, { action: 'settle', amount: '100' }, { action: 'keep' }]) {
      await expect(svc.decide(id, { ...exp(d2), ...body, reason: 'من الصفحة القديمة' }, APPROVER)).rejects.toMatchObject({ status: 409 });
    }
    // بلا الحالة المعروضة: لا يُربط تلقائيّاً بالأحدث
    await expect(svc.decide(id, { kind: 'batch_resolution', row_id: d2.row_id, action: 'replace', reason: 'بلا بصمة' }, APPROVER)).rejects.toMatchObject({ status: 428 });
    expect(await count()).toBe(0);
    await expect(svc.exportPayments(id, 'EUR', CLERK)).rejects.toThrow(/تنتظر قرار المالك/);
    expect((await rowsOf(id)).map((r) => r.amount)).toEqual(['1650.00']);
    // بعد تحديث اللوحة: القرار على V3 كما يُعرض الآن
    const d3 = (await view(id)).batch_decisions[0];
    expect(d3).toMatchObject({ version_no: 3, balance: '2450.00', row_id: d2.row_id });
    await svc.decide(id, { ...exp(d3), action: 'replace', reason: 'لم يُنفَّذ الأوّل' }, APPROVER);
    const x = await svc.exportPayments(id, 'EUR', CLERK);
    expect(sheetRows(x.buffer).map((r) => [r[1], r[16]])).toEqual([['9751', 2450]]);
  });

  it('قرارٌ فُتح ثمّ اعتُمد تغيير الحساب وحده: يُرفض 409 — والقرار على الحساب الجديد يمرّ', async () => {
    const id = await cycleWith('Stale Bank', [crew('9752')]);
    await bank(id, '9752', 1);
    await submitApprove(id, 'الأوّل');
    await svc.exportPayments(id, 'EUR', CLERK);
    await setBasic(id, '9752', '1100');
    await submitApprove(id, 'الإصدار ٢');
    const d2 = (await view(id)).batch_decisions[0];
    await bank(id, '9752', 2);
    await submitApprove(id, 'حسابٌ جديد');
    await expect(svc.decide(id, { ...exp(d2), action: 'settle', amount: '100', reason: 'قديم' }, APPROVER)).rejects.toMatchObject({ status: 409 });
    const d3 = (await view(id)).batch_decisions[0];
    expect(d3).toMatchObject({ bank_changed: true, amount_changed: true });
    await svc.decide(id, { ...exp(d3), action: 'settle', amount: '100', reason: 'نُفِّذ الأوّل' }, APPROVER);
    expect(sheetRows((await svc.exportPayments(id, 'EUR', CLERK)).buffer).map((r) => [r[1], r[16]])).toEqual([['9752', 100]]);
  });

  // ══════════════ التزامن: التصدير والاعتماد ══════════════
  const raceSetup = async (vessel: string, crewId: string) => {
    const id = await cycleWith(vessel, [crew(crewId)]);
    await bank(id, crewId);
    const v1 = await submitApprove(id, 'الأوّل');
    await setBasic(id, crewId, '1100');
    await svc.submit(id, 'التصحيح', CLERK);
    const v2 = await latest(id);
    return { id, v1, v2, cycleKey: `crew_salary:cycle:${id}` };
  };

  it('تصدير الإصدار السابق يسبق اعتماد المصحَّح: يخرج بالسابق، والمصحَّح ينتظر قرار المالك لا فرقاً آليّاً', async () => {
    const { id, v1, v2, cycleKey } = await raceSetup('Race One', '9621');
    const h = await hold(cycleKey);
    const ex = track(svc.exportPayments(id, 'EUR', CLERK, v1.id));
    await untilWaiters(1);
    const ap = track(svc.approve(v2.id, 'اعتماد المصحَّح', APPROVER));
    await untilWaiters(2);
    expect([ex.done, ap.done]).toEqual([false, false]); // كلاهما خلف القفل قبل أيّ قراءة
    await h.release();
    const [x] = await Promise.all([ex.p, ap.p]);
    expect(sheetRows(x.buffer).map((r) => [r[1], r[16]])).toEqual([['9621', 1650]]);
    await expect(svc.exportPayments(id, 'EUR', CLERK)).rejects.toThrow(/تنتظر قرار المالك/);
    expect(await activeOut(id)).toEqual({ '9621:EUR': '1650.00' });
  });

  it('اعتماد المصحَّح يسبق تصدير السابق: التصدير يُعيد القراءة بعد القفل فلا يُخرج حالةً استُبدلت', async () => {
    const { id, v1, v2, cycleKey } = await raceSetup('Race Two', '9622');
    const h = await hold(cycleKey);
    const ap = track(svc.approve(v2.id, 'اعتماد المصحَّح', APPROVER));
    await untilWaiters(1);
    const ex = track(svc.exportPayments(id, 'EUR', CLERK, v1.id));
    await untilWaiters(2); // التصدير ينتظر القفل قبل أن يقرأ شيئاً
    await h.release();
    await ap.p;
    await expect(ex.p).rejects.toThrow(/حلّ محلّ هذا الإصدار/);
    expect(await rowsOf(id)).toEqual([]);
    // والمصحَّح يخرج كاملاً مرّةً واحدة
    const x = await svc.exportPayments(id, 'EUR', CLERK);
    expect(sheetRows(x.buffer).map((r) => [r[1], r[16]])).toEqual([['9622', 1750]]);
    expect(await activeOut(id)).toEqual({ '9622:EUR': '1750.00' });
  });

  it('قرار المالك والتصدير المتزامنان: القرار يُستهلك مرّةً واحدة', async () => {
    const id = await cycleWith('Race Three', [crew('9623')]);
    await bank(id, '9623');
    await submitApprove(id, 'الأوّل');
    await svc.exportPayments(id, 'EUR', CLERK);
    await setBasic(id, '9623', '1100');
    await submitApprove(id, 'الزيادة');
    const row = (await view(id)).batch_decisions[0];
    await svc.decide(id, { ...exp(row), action: 'replace', reason: 'لم يُنفَّذ' }, APPROVER);
    const res = await Promise.allSettled([svc.exportPayments(id, 'EUR', CLERK), svc.exportPayments(id, 'EUR', CLERK)]);
    const ok = res.filter((r) => r.status === 'fulfilled').map((r) => (r as PromiseFulfilledResult<any>).value);
    expect(ok.map((x) => x.redownload).sort()).toEqual([false, true]);
    expect((await rowsOf(id)).filter((r) => r.status === 'active').map((r) => r.amount)).toEqual(['1750.00']);
  });

  // ══════════════ التزامن: بطاقة الأسعار القديمة والاعتماد ══════════════
  const fxCycle = async (vessel: string, crewId: string, month: string) => {
    const [y, m] = month.split('-').map(Number);
    const id = await cycleWith(vessel, [crew(crewId)], { y, m, name: `${['', '', '', '', '', '', 'June', 'July', 'August'][m]} ${y}` });
    expect((await view(id)).cycle.month).toBe(month);
    await bank(id, crewId);
    await svc.decide(id, { kind: 'payment_currency', target_key: `${crewId}:EUR`, currency: 'USD', reason: 'حسابه بالدولار بطلبه' }, CLERK);
    await svc.setFx(month, 'EUR', '1.17', 'نشرة البنك', FINANCE);
    await ack(id, crewId);
    await svc.submit(id, 'بالدولار', CLERK);
    return { id, v: await latest(id) };
  };

  it('بطاقة الأسعار خلف قفل الشهر: لا يتغيّر السعر أثناء الاعتماد، ويُعتمد الإصدار بسعره المقدَّم', async () => {
    const { v } = await fxCycle('Fx One', '9631', '2026-08');
    const base = await rates.getMonth('2026-08');
    const h = await hold('crew_salary:fx:2026-08');
    const ap = track(svc.approve(v.id, 'اعتماد', APPROVER));
    await untilWaiters(1);
    const up = track(rates.upsert('2026-08', { ...base, EUR: 1 / 1.2 }, base));
    await untilWaiters(2);
    await new Promise((r) => setTimeout(r, 200));
    expect([ap.done, up.done]).toEqual([false, false]); // المسار القديم نفسه ينتظر القفل
    await h.release();
    await Promise.all([ap.p, up.p]);
    const saved = await ds.getRepository(CrewSalaryVersion).findOne({ where: { id: v.id } });
    expect(saved!.status).toBe('approved');
    expect(saved!.fx_snapshot.labels.join()).toMatch(/1\.17/);
    expect(Number((await rates.getMonth('2026-08')).EUR)).toBeCloseTo(1 / 1.2, 12);
  });

  it('سعرٌ تغيّر قبل الاعتماد عبر البطاقة: الاعتماد يُرفض — لا تُعتمد بصمةٌ بسعرٍ غير سعرها', async () => {
    const { v } = await fxCycle('Fx Two', '9632', '2026-07');
    const base = await rates.getMonth('2026-07');
    const h = await hold('crew_salary:fx:2026-07');
    const up = track(rates.upsert('2026-07', { ...base, EUR: 1 / 1.2 }, base));
    await untilWaiters(1);
    const ap = track(svc.approve(v.id, 'اعتماد', APPROVER));
    await untilWaiters(2);
    await h.release();
    await up.p;
    await expect(ap.p).rejects.toThrow(/أعِد التقديم/);
    expect((await ds.getRepository(CrewSalaryVersion).findOne({ where: { id: v.id } }))!.status).toBe('submitted');
  });

  it('لا ضياع تحديث: بطاقةٌ بأسعارٍ قديمة تُرفض (409)، وحفظٌ بلا base مرفوض (428)', async () => {
    await rates.upsert('2026-06', { EGP: 50 }, {});
    const seen = await rates.getMonth('2026-06');
    await svc.setFx('2026-06', 'EUR', '1.16', 'مرتّبات', FINANCE); // كتابةٌ ذرّيّة بعد قراءة البطاقة
    await expect(rates.upsert('2026-06', { ...seen, EGP: 51 }, seen)).rejects.toMatchObject({ status: 409 });
    expect(Object.keys(await rates.getMonth('2026-06')).sort()).toEqual(['EGP', 'EUR']);
    await expect(rates.upsert('2026-06', { EGP: 52 }, undefined)).rejects.toMatchObject({ status: 428 });
    const fresh = await rates.getMonth('2026-06');
    await rates.upsert('2026-06', { ...fresh, EGP: 51 }, fresh);
    const now = await rates.getMonth('2026-06');
    expect([Number(now.EGP), Number(now.EUR)]).toEqual([51, Number(fresh.EUR)]);
    // متزامنتان بالقاعدة نفسها: تمرّ واحدة وتُرفض الأخرى
    const res = await Promise.allSettled([rates.upsert('2026-06', { ...now, EGP: 53 }, now), rates.upsert('2026-06', { ...now, EGP: 54 }, now)]);
    expect(res.map((r) => r.status).sort()).toEqual(['fulfilled', 'rejected']);
  });
});
