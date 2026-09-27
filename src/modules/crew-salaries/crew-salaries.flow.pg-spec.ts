import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { freshDb } from '../../../test/pg/db';
import { ExchangeRate } from '../exchange-rates/exchange-rate.entity';
import { ExchangeRatesService } from '../exchange-rates/exchange-rates.service';
import { CREW_SALARY_ENTITIES, CrewSalaryAudit, CrewSalaryEntitlement, CrewSalaryFile } from './crew-salary.entity';
import { CrewSalariesService, type Actor } from './crew-salaries.service';
import { fakeCfm } from './crew-salary.fixture';

/*
 * سير العمل كاملاً على PostgreSQL حقيقيّة مؤقّتة — ببياناتٍ اصطناعيّة.
 * الاستيراد ⇐ المراجعة ⇐ التقديم ⇐ الاعتماد ⇐ التصدير، وحدود الصلاحية والازدواج.
 */
const UP = fs.readFileSync(path.join(__dirname, '../../../docs/crew-salaries-up.sql'), 'utf8');
const APPROVER: Actor = { id: randomUUID(), email: 'approver@test.local', full_name: 'Approver' };
const CLERK: Actor = { id: randomUUID(), email: 'clerk@test.local', full_name: 'Clerk', role: 'admin' };

const crewA = { id: '9101', name: 'Alpha, Test', rank: 'Master', section: 'monthly' as const, start: 1, end: 31, rates: [3000, 1200, 750] as [number, number, number], advance: 500 };
const crewB = { id: '9102', name: 'Bravo, Test', rank: 'M/M', section: 'final' as const, start: 1, end: 20, rates: [1697, 679, 424] as [number, number, number], others: [{ label: 'Other', description: 'Salary of 1 day to sign off', amount: 93.33 }] };

describe('سير عمل مرتّبات الأطقم على PostgreSQL', () => {
  let db: Awaited<ReturnType<typeof freshDb>>;
  let ds: DataSource;
  let svc: CrewSalariesService;
  let cycleId: string;
  const env = process.env.CREW_SALARY_APPROVER_USER_ID;

  beforeAll(async () => {
    db = await freshDb('crew_flow');
    ds = new DataSource({ type: 'postgres', url: db.url, entities: [...CREW_SALARY_ENTITIES, ExchangeRate], synchronize: false });
    await ds.initialize();
    await ds.query(UP);
    // جدول الأسعار القائم في الإنتاج — بصيغته
    await ds.query(`CREATE TABLE exchange_rates (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), month varchar UNIQUE NOT NULL, rates jsonb, updated_at timestamp NOT NULL DEFAULT now())`);
    svc = new CrewSalariesService(ds, new ExchangeRatesService(ds.getRepository(ExchangeRate)));
    delete process.env.CREW_SALARY_APPROVER_USER_ID;
  });
  afterAll(async () => {
    if (env === undefined) delete process.env.CREW_SALARY_APPROVER_USER_ID; else process.env.CREW_SALARY_APPROVER_USER_ID = env;
    await ds?.destroy(); await db?.drop();
  });

  it('الاستيراد: يستنتج المركب والشهر من المحتوى، ويرفض التكرار', async () => {
    const buf = fakeCfm('Test Vessel', 'EUR', [crewA, crewB]);
    const r: any = await svc.importFile(buf, 'export 2026-09-02.xlsx', CLERK);
    expect(r.duplicate).toBe(false);
    expect(r.inference).toMatchObject({ vessel: 'Test Vessel', month: '2026-08' });
    cycleId = r.cycle_id;
    const again: any = await svc.importFile(buf, 'copy.xlsx', CLERK);
    expect(again).toMatchObject({ duplicate: true, cycle_id: cycleId });
    expect(await ds.getRepository(CrewSalaryFile).count()).toBe(1);
    await expect(svc.importFile(Buffer.from('x'), 'evil.xlsm', CLERK)).rejects.toThrow(/بلا ماكرو/);
  });

  it('العرض: الحساب المستقلّ وفرق يوم النزول (79.20 مقابل 93.33) والسلفة معلّقة', async () => {
    const v: any = await svc.view(cycleId, CLERK);
    expect(v.entries).toHaveLength(2);
    const b = v.entries.find((e: any) => e.crew_id === '9102');
    expect(b.result.items.find((i: any) => i.kind === 'sign_off_day').amount).toBe('79.20');
    expect(b.differences.find((d: any) => d.kind === 'sign_off_day').diff).toBe('-14.13');
    const a = v.entries.find((e: any) => e.crew_id === '9101');
    expect(a.result.issues.map((i: any) => i.code)).toContain('item_pending_review');
    expect(v.permissions).toEqual({ approver_configured: false, can_approve: false });
    expect(v.totals.EUR.count).toBe(2);
  });

  it('التقديم يُرفض قبل المراجعة، ويُقبل بعد قبول البنود وإقرار الفروق', async () => {
    await expect(svc.submit(cycleId, 'أوّل تقديم', CLERK)).rejects.toThrow(/لم تكتمل مراجعتها/);
    const v: any = await svc.view(cycleId, CLERK);
    for (const e of v.entries) {
      for (const x of e.extras) await svc.decide(cycleId, { kind: 'item_review', target_key: x.key, decision: 'accepted' }, CLERK);
    }
    const b = (await svc.view(cycleId, CLERK) as any).entries.find((e: any) => e.crew_id === '9102');
    await expect(svc.decide(cycleId, { kind: 'difference_ack', target_key: b.key, hash: b.diff_hash, reason: '' }, CLERK)).rejects.toThrow(/مطلوبٌ/);
    await svc.decide(cycleId, { kind: 'difference_ack', target_key: b.key, hash: b.diff_hash, reason: 'القاعدة المعتمدة بلا بدل الإجازة' }, CLERK);
    const s = await svc.submit(cycleId, 'مراجعة أغسطس', CLERK);
    expect(s.version_no).toBe(1);
    await expect(svc.submit(cycleId, 'مكرّر', CLERK)).rejects.toThrow(/بالمحتوى نفسه/);
  });

  it('الاعتماد مرفوضٌ افتراضيّاً — ولغير المعتمد المعيَّن، ولو كان أدمن', async () => {
    const v: any = await svc.view(cycleId, CLERK);
    const ver = v.versions[0].id;
    await expect(svc.approve(ver, 'اعتماد', APPROVER)).rejects.toThrow(/لم يُعيَّن/);
    process.env.CREW_SALARY_APPROVER_USER_ID = APPROVER.id;
    await expect(svc.approve(ver, 'اعتماد', CLERK)).rejects.toThrow(/وحده/);
    const r = await svc.approve(ver, 'اعتماد أغسطس', APPROVER);
    expect(r.entitlements).toBeGreaterThan(0);
    expect(await ds.getRepository(CrewSalaryEntitlement).count({ where: { active: true } })).toBe(r.entitlements);
  });

  it('لا كشف صرف بلا حسابٍ معتمد — والتصدير ليس سداداً', async () => {
    await expect(svc.exportPayments(cycleId, 'EUR', CLERK)).rejects.toThrow(/لا حالات مكتملة/);
  });

  it('الحسابات: المستورَد لا يُعتمد تلقائيّاً، والمستفيد غير البحّار يلزمه تفويضٌ معتمد', async () => {
    const a = await svc.addBankAccount({ crew_id: '9101', beneficiary: 'Alpha Test', bank: 'Test Bank', iban: 'XX00 TEST 0000 0000 0001', reason: 'صفحة الحساب في العقد' }, CLERK, cycleId);
    const b = await svc.addBankAccount({ crew_id: '9102', beneficiary: 'Spouse Of Bravo', bank: 'Test Bank', account_number: '000123', reason: 'طلب البحّار' }, CLERK, cycleId);
    expect(a.status).toBe('imported');
    expect(a.iban).toBe('XX00TEST000000000001');
    await expect(svc.reviewBankAccount(a.id, { decision: 'approved', beneficiary_is_seafarer: true, reason: 'مطابق' }, CLERK, cycleId)).rejects.toThrow(/وحده/);
    await svc.reviewBankAccount(a.id, { decision: 'approved', beneficiary_is_seafarer: true, reason: 'مطابق للعقد' }, APPROVER, cycleId);
    await expect(svc.reviewBankAccount(b.id, { decision: 'approved', beneficiary_is_seafarer: false, reason: 'زوجة' }, APPROVER, cycleId)).rejects.toThrow(/تفويضٌ معتمد/);
    const z = await svc.createAuthorization({ crew_id: '9102', beneficiary: 'Spouse Of Bravo', relation: 'زوجة', valid_from: '2026-01-01' }, { buffer: Buffer.from('%PDF-1.4 test'), originalname: 'auth.pdf' }, CLERK, cycleId);
    await svc.reviewAuthorization(z.id, { decision: 'approved', reason: 'تفويضٌ موقَّع' }, APPROVER, cycleId);
    await svc.reviewBankAccount(b.id, { decision: 'approved', beneficiary_is_seafarer: false, authorization_id: z.id, reason: 'بتفويض' }, APPROVER, cycleId);
    const v: any = await svc.view(cycleId, CLERK);
    expect(v.changed_since_approval).toBe(true);
    expect(v.entries.every((e: any) => e.payable)).toBe(true);
  });

  it('التغيير الجوهريّ بعد الاعتماد ⇒ إصدارٌ جديد يحلّ محلّ السابق دون ازدواج استحقاق', async () => {
    const s = await svc.submit(cycleId, 'بعد اعتماد الحسابات', CLERK);
    expect(s.version_no).toBe(2);
    const v: any = await svc.view(cycleId, CLERK);
    const r = await svc.approve(v.versions[0].id, 'اعتماد الإصدار الثاني', APPROVER);
    const active = await ds.getRepository(CrewSalaryEntitlement).count({ where: { active: true } });
    expect(active).toBe(r.entitlements);
    const after: any = await svc.view(cycleId, CLERK);
    expect(after.versions.map((x: any) => [x.version_no, x.status])).toEqual([[2, 'approved'], [1, 'superseded']]);
    expect(after.changed_since_approval).toBe(false);
  });

  it('كشف الصرف: من الإصدار المعتمد، وإعادة التنزيل لا تنشئ دفعةً ولا استحقاقاً جديداً', async () => {
    const before = await ds.getRepository(CrewSalaryEntitlement).count();
    const x = await svc.exportPayments(cycleId, 'EUR', CLERK);
    expect(x.redownload).toBe(false);
    expect(x.filename).toBe('CS-TESTVESSEL-202608-V2-EUR.xlsx');
    const y = await svc.exportPayments(cycleId, 'EUR', CLERK);
    expect(y.redownload).toBe(true);
    expect(y.filename).toBe(x.filename);
    expect(await ds.getRepository(CrewSalaryEntitlement).count()).toBe(before);
    const rev = await svc.exportReview(cycleId, CLERK);
    expect(rev.buffer.length).toBeGreaterThan(1000);
  });

  it('سعرُ عملةٍ لا تخصّ الدورة لا يغيّر بصمة الإصدار المعتمد', async () => {
    await svc.setFx('2026-08', 'EGP', '0.02', 'سعر التقارير', CLERK);
    const v: any = await svc.view(cycleId, CLERK);
    expect(v.changed_since_approval).toBe(false);
  });

  it('الاستحقاق نفسه في دورةٍ أخرى (مركبٌ آخر، الفترة نفسها) لا يُعتمد', async () => {
    const r: any = await svc.importFile(fakeCfm('Other Vessel', 'EUR', [{ ...crewA, advance: undefined }]), 'other.xlsx', CLERK);
    const v: any = await svc.view(r.cycle_id, CLERK);
    expect(v.entries[0].extras).toEqual([]);
    await svc.submit(r.cycle_id, 'دورةٌ مكرّرة', CLERK);
    const v2: any = await svc.view(r.cycle_id, CLERK);
    await expect(svc.approve(v2.versions[0].id, 'اعتماد', APPROVER)).rejects.toThrow(/استحقاقٌ مكرَّر/);
  });

  it('النسخة المصحَّحة من تصدير CFM تحلّ محلّ السابقة بالعملة نفسها', async () => {
    const r: any = await svc.importFile(fakeCfm('Test Vessel', 'EUR', [{ ...crewA, rates: [3100, 1200, 750] }, crewB]), 'corrected.xlsx', CLERK);
    expect(r.cycle_id).toBe(cycleId);
    const files = await ds.getRepository(CrewSalaryFile).find({ where: { cycle_id: cycleId } });
    expect(files.map((f) => f.status).sort()).toEqual(['extracted', 'superseded']);
    const v: any = await svc.view(cycleId, CLERK);
    expect(v.changed_since_approval).toBe(true);
    expect(v.entries.find((e: any) => e.crew_id === '9101').result.items[0].amount).toBe('3100.00');
  });

  it('سعر الصرف: «١ EUR = 1.15 USD» في جدول الأسعار القائم، بلا مسّ العملات الأخرى', async () => {
    const r = await svc.setFx('2026-08', 'EUR', '1.15', 'نشرة البنك', CLERK);
    expect(r.label).toBe('1 EUR = 1.150000 USD');
    const row = await ds.query(`SELECT rates FROM exchange_rates WHERE month='2026-08'`);
    expect(row[0].rates.EGP).toBe(50);
    expect(row[0].rates.EUR).toBeCloseTo(1 / 1.15, 12);
    await expect(svc.setFx('2026-08', 'EUR', '0', 'x', CLERK)).rejects.toThrow(/موجب/);
  });

  it('سجلّ التدقيق يحفظ من فعل ماذا ومتى ولماذا — ولا يُعدَّل', async () => {
    const rows = await ds.getRepository(CrewSalaryAudit).find();
    const actions = new Set(rows.map((r) => r.action));
    for (const a of ['import', 'import_duplicate', 'decision_item_review', 'decision_difference_ack', 'submitted', 'approved', 'bank_approved', 'authorization_approved', 'export_payments', 'export_payments_redownload', 'fx_set']) {
      expect(actions.has(a)).toBe(true);
    }
    const approved = rows.find((r) => r.action === 'approved')!;
    expect(approved).toMatchObject({ user_id: APPROVER.id, user_name: 'Approver' });
    expect(approved.reason.length).toBeGreaterThan(2);
    await expect(ds.query(`UPDATE crew_salary_audit SET reason = 'x' WHERE id = $1`, [approved.id])).rejects.toThrow(/إلحاقٌ فقط/);
  });
});
