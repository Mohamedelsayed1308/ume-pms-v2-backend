import * as fs from 'fs';
import * as path from 'path';
import * as XLSX from 'xlsx';
import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { freshDb } from '../../../test/pg/db';
import { ExchangeRate } from '../exchange-rates/exchange-rate.entity';
import { ExchangeRatesService } from '../exchange-rates/exchange-rates.service';
import type { ScreenAuthzService } from '../../common/screen-authz.service';
import { CREW_SALARY_ENTITIES, CrewSalaryAudit, CrewSalaryEntitlement, CrewSalaryFile, CrewSalaryVersion } from './crew-salary.entity';
import { CrewSalariesService, type Actor } from './crew-salaries.service';
import { fakeCfm, type FakeCrew } from './crew-salary.fixture';

/*
 * سير العمل كاملاً على PostgreSQL حقيقيّة مؤقّتة — ببياناتٍ اصطناعيّة.
 * الاستيراد ⇐ المراجعة ⇐ التقديم الجزئيّ ⇐ الاعتماد ⇐ التصدير، مع التزامن والصلاحيات والازدواج.
 */
const UP = fs.readFileSync(path.join(__dirname, '../../../docs/crew-salaries-up.sql'), 'utf8');
const APPROVER: Actor = { id: randomUUID(), email: 'approver@test.local', full_name: 'Approver' };
const CLERK: Actor = { id: randomUUID(), email: 'clerk@test.local', full_name: 'Clerk', role: 'admin' };
const FINANCE: Actor = { id: randomUUID(), email: 'finance@test.local', full_name: 'Finance' };
// صلاحية تعديل أسعار الشركة (شاشة التقارير) لـ FINANCE وحده — الأدمن لا يُفترض له شيء هنا
const authz = { can: async (id: string, href: string) => href === '/dashboard/reports' && id === FINANCE.id } as unknown as ScreenAuthzService;

const crewA: FakeCrew = { id: '9101', name: 'Alpha, Test', rank: 'Master', section: 'monthly', start: 1, end: 31, rates: [3000, 1200, 750], advance: 500 };
const crewB: FakeCrew = { id: '9102', name: 'Bravo, Test', rank: 'M/M', section: 'final', start: 1, end: 20, rates: [1697, 679, 424], others: [{ label: 'Other', description: 'Salary of 1 day to sign off', amount: 93.33 }] };

describe('سير عمل مرتّبات الأطقم على PostgreSQL', () => {
  let db: Awaited<ReturnType<typeof freshDb>>;
  let ds: DataSource;
  let svc: CrewSalariesService;
  let cycleId: string;
  const env = process.env.CREW_SALARY_APPROVER_USER_ID;
  const view = (id?: string): Promise<any> => svc.view(id ?? cycleId, CLERK);
  const entry = async (crew: string, id?: string) => (await view(id)).entries.find((e: any) => e.crew_id === crew);
  const acceptAll = async (crew: string, id?: string) => {
    for (const x of (await entry(crew, id)).extras) await svc.decide(id ?? cycleId, { kind: 'item_review', target_key: x.key, decision: 'accepted' }, CLERK);
  };
  const latest = async (id?: string) => (await view(id)).versions[0];
  /** تغيير المرتّب يُحدث فرقاً عن CFM — والفرق يُقرّ بسببٍ قبل التقديم. */
  const ack = async (crew: string, id?: string) => {
    const e = await entry(crew, id);
    if (e.diff_hash && !e.differences_acknowledged) await svc.decide(id ?? cycleId, { kind: 'difference_ack', target_key: e.key, hash: e.diff_hash, reason: 'تصحيحٌ موثَّق' }, CLERK);
  };
  /** لا ازدواج: كلّ حالةٍ نشطةٌ من إصدارٍ واحد. */
  const noDoubleEntitlements = async () => {
    const rows = await ds.query(`SELECT entry_key, count(DISTINCT version_id)::int n FROM crew_salary_entitlements WHERE active GROUP BY cycle_id, entry_key`);
    expect(rows.every((r: any) => r.n === 1)).toBe(true);
  };
  const activeEnt = () => ds.getRepository(CrewSalaryEntitlement).count({ where: { active: true } });

  beforeAll(async () => {
    db = await freshDb('crew_flow');
    ds = new DataSource({ type: 'postgres', url: db.url, entities: [...CREW_SALARY_ENTITIES, ExchangeRate], synchronize: false });
    await ds.initialize();
    await ds.query(UP);
    // جدول الأسعار القائم في الإنتاج — بصيغته وقيده الفريد
    await ds.query(`CREATE TABLE exchange_rates (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), month varchar UNIQUE NOT NULL, rates jsonb, updated_at timestamp NOT NULL DEFAULT now())`);
    svc = new CrewSalariesService(ds, new ExchangeRatesService(ds.getRepository(ExchangeRate)), authz);
    delete process.env.CREW_SALARY_APPROVER_USER_ID;
  });
  afterAll(async () => {
    if (env === undefined) delete process.env.CREW_SALARY_APPROVER_USER_ID; else process.env.CREW_SALARY_APPROVER_USER_ID = env;
    await ds?.destroy(); await db?.drop();
  });

  it('الاستيراد: يستنتج المركب والشهر من المحتوى، ويرفض التكرار والماكرو', async () => {
    const buf = fakeCfm('Test Vessel', 'EUR', [crewA, crewB]);
    const r: any = await svc.importFile(buf, 'export 2026-09-02.xlsx', CLERK);
    expect(r.inference).toMatchObject({ vessel: 'Test Vessel', month: '2026-08' });
    cycleId = r.cycle_id;
    expect(await svc.importFile(buf, 'copy.xlsx', CLERK)).toMatchObject({ duplicate: true, cycle_id: cycleId });
    expect(await ds.getRepository(CrewSalaryFile).count()).toBe(1);
    await expect(svc.importFile(Buffer.from('x'), 'evil.xlsm', CLERK)).rejects.toThrow(/بلا ماكرو/);
    // xlsx مُعاد التسمية وفيه مشروع VBA — يُرفض كالمرفقات
    const vba = Buffer.concat([buf, Buffer.from('xl/vbaProject.bin')]);
    await expect(svc.importFile(vba, 'renamed.xlsx', CLERK)).rejects.toThrow(/ماكرو/);
  });

  it('الحساب المستقلّ: فرق يوم النزول (79.20 مقابل 93.33)، والسلفة معلّقة', async () => {
    const v = await view();
    expect(v.entries).toHaveLength(2);
    const b = v.entries.find((e: any) => e.crew_id === '9102');
    expect(b.result.items.find((i: any) => i.kind === 'sign_off_day').amount).toBe('79.20');
    expect(b.differences.find((d: any) => d.kind === 'sign_off_day').diff).toBe('-14.13');
    expect(v.permissions).toEqual({ approver_configured: false, can_approve: false, can_edit_fx: false });
  });

  it('تصحيح «ينزل هذا الشهر» بالنصّ "false" يُقرأ خطأً لا صحّاً', async () => {
    await svc.decide(cycleId, { kind: 'field_override', target_key: '9102:EUR|signs_off', value: 'false', reason: 'اختبار القراءة' }, CLERK);
    expect((await entry('9102')).result.items.some((i: any) => i.kind === 'sign_off_day')).toBe(false);
    await svc.decide(cycleId, { kind: 'field_override', target_key: '9102:EUR|signs_off', value: 'true', reason: 'إعادةٌ للأصل' }, CLERK);
    expect((await entry('9102')).result.items.some((i: any) => i.kind === 'sign_off_day')).toBe(true);
    await expect(svc.decide(cycleId, { kind: 'field_override', target_key: '9102:EUR|signs_off', value: 'no', reason: 'قيمةٌ غير صالحة' }, CLERK)).rejects.toThrow(/true أو false/);
  });

  it('التقديم الجزئيّ: المكتمل يُقدَّم، والمعلّق يبقى خارجه ظاهراً بأسبابه', async () => {
    await expect(svc.submit(cycleId, 'لا شيء جاهز', CLERK)).rejects.toThrow(/لا حالة جاهزة/);
    await acceptAll('9101');
    const s: any = await svc.submit(cycleId, 'الجاهز أوّلاً', CLERK);
    expect(s.version_no).toBe(1);
    expect(s.entries).toBe(1);
    expect(s.excluded.map((x: any) => [x.crew_id, x.reasons.join()])).toEqual([['9102', 'فروقٌ أو تعارضاتٌ لم تُراجَع,لا حساب صرف']]);
    expect(s.totals._partial).toBe(true);
  });

  it('الاعتماد مرفوضٌ افتراضيّاً — ولغير المعتمد المعيَّن ولو كان أدمن', async () => {
    const v1 = await latest();
    await expect(svc.approve(v1.id, 'اعتماد', APPROVER)).rejects.toThrow(/لم يُعيَّن/);
    process.env.CREW_SALARY_APPROVER_USER_ID = APPROVER.id;
    await expect(svc.approve(v1.id, 'اعتماد', CLERK)).rejects.toThrow(/وحده/);
    const r = await svc.approve(v1.id, 'اعتماد الجاهز', APPROVER);
    expect(await activeEnt()).toBe(r.entitlements);
  });

  it('استكمال المعلّق لاحقاً دون تكرار ما اعتُمد — وطلبا اعتمادٍ متزامنان يمرّ أحدهما فقط', async () => {
    const b = await entry('9102');
    await svc.decide(cycleId, { kind: 'difference_ack', target_key: b.key, hash: b.diff_hash, reason: 'القاعدة المعتمدة بلا بدل الإجازة' }, CLERK);
    const s: any = await svc.submit(cycleId, 'المعلّق بعد استكماله', CLERK);
    expect(s.entries).toBe(1); // 9101 معتمَدة بلا تغيير فلا تُعاد
    const v2 = await latest();
    const before = await activeEnt();
    const res = await Promise.allSettled([svc.approve(v2.id, 'اعتماد ١', APPROVER), svc.approve(v2.id, 'اعتماد ٢', APPROVER)]);
    expect(res.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    expect(String((res.find((x) => x.status === 'rejected') as PromiseRejectedResult).reason)).toMatch(/ليس مقدَّماً/);
    const after = await activeEnt();
    expect(after - before).toBe((res.find((x) => x.status === 'fulfilled') as PromiseFulfilledResult<any>).value.entitlements);
    const vs = (await view()).versions.map((x: any) => [x.version_no, x.status]);
    expect(vs).toEqual([[2, 'approved'], [1, 'approved']]);
    expect((await view()).entries.every((e: any) => e.approval && !e.approval.changed)).toBe(true);
  });

  it('التعديل بعد التقديم يُبطل الاعتماد — لا يُعتمد ما لم يُراجَع', async () => {
    await svc.decide(cycleId, { kind: 'field_override', target_key: '9101:EUR|basic', value: '3050', reason: 'تصحيح المرتّب' }, CLERK);
    await ack('9101');
    await svc.submit(cycleId, 'تصحيح', CLERK);
    const v3 = await latest();
    await svc.decide(cycleId, { kind: 'field_override', target_key: '9101:EUR|basic', value: '3060', reason: 'تصحيحٌ ثانٍ قبل الاعتماد' }, CLERK);
    await expect(svc.approve(v3.id, 'اعتماد', APPROVER)).rejects.toThrow(/أعِد التقديم/);
    await svc.decide(cycleId, { kind: 'field_override', target_key: '9101:EUR|basic', value: '3000', reason: 'رجوعٌ إلى المرتّب المعتمد' }, CLERK);
  });

  it('الحسابات: المستورَد لا يُعتمد تلقائيّاً، والمستفيد غير البحّار يلزمه تفويضٌ معتمد', async () => {
    const a = await svc.addBankAccount({ crew_id: '9101', beneficiary: 'Alpha Test', bank: 'Test Bank', iban: 'XX00 TEST 0000 0000 0001', reason: 'صفحة الحساب في العقد' }, CLERK, cycleId);
    const b = await svc.addBankAccount({ crew_id: '9102', beneficiary: 'Spouse Of Bravo', bank: 'Test Bank', account_number: '000123', reason: 'طلب البحّار' }, CLERK, cycleId);
    expect(a.status).toBe('imported');
    expect(a).not.toHaveProperty('national_id');
    await expect(svc.reviewBankAccount(a.id, { decision: 'approved', beneficiary_is_seafarer: true, reason: 'مطابق' }, CLERK, cycleId)).rejects.toThrow(/وحده/);
    await svc.reviewBankAccount(a.id, { decision: 'approved', beneficiary_is_seafarer: true, reason: 'مطابق للعقد' }, APPROVER, cycleId);
    await expect(svc.reviewBankAccount(b.id, { decision: 'approved', beneficiary_is_seafarer: false, reason: 'زوجة' }, APPROVER, cycleId)).rejects.toThrow(/تفويضٌ معتمد/);
    const z = await svc.createAuthorization({ crew_id: '9102', beneficiary: 'Spouse Of Bravo', relation: 'زوجة', valid_from: '2026-01-01' }, { buffer: Buffer.from('%PDF-1.4 test'), originalname: 'auth.pdf' }, CLERK, cycleId);
    await svc.reviewAuthorization(z.id, { decision: 'approved', reason: 'تفويضٌ موقَّع' }, APPROVER, cycleId);
    await svc.reviewBankAccount(b.id, { decision: 'approved', beneficiary_is_seafarer: 'false', authorization_id: z.id, reason: 'بتفويض' }, APPROVER, cycleId);
    const v = await view();
    expect(v.changed_since_approval).toBe(true); // الحساب جزءٌ من الحالة المعتمدة
    expect(v.entries.every((e: any) => e.payable && e.eligible)).toBe(true);
  });

  it('تسجيل حسابٍ مستورَدٍ لم يُعتمد لا يجعل الحالة المعتمدة «متغيّرة»', async () => {
    const c: FakeCrew = { id: '9401', name: 'Delta, Test', rank: 'AB', section: 'monthly', start: 1, end: 31, rates: [1000, 400, 250] };
    const r: any = await svc.importFile(fakeCfm('Vessel Z', 'EUR', [c]), 'z.xlsx', CLERK);
    await svc.submit(r.cycle_id, 'بلا حساب', CLERK);
    await svc.approve((await latest(r.cycle_id)).id, 'اعتماد', APPROVER);
    await svc.addBankAccount({ crew_id: '9401', beneficiary: 'Delta Test', bank: 'Test Bank', iban: 'XX00TEST0000000000009', reason: 'مستورَد' }, CLERK, r.cycle_id);
    const e = await entry('9401', r.cycle_id);
    expect(e.approval).toMatchObject({ changed: false });
    expect(e.blockers).toContain('حسابٌ مستورَدٌ لم يُعتمد بعد');
  });

  it('التعديل الجوهريّ ⇒ إصدارٌ يراجع السابق حالةً حالة دون ازدواج استحقاق', async () => {
    await svc.submit(cycleId, 'بعد اعتماد الحسابات', CLERK);
    const v4 = await latest();
    const r = await svc.approve(v4.id, 'اعتماد الإصدار الرابع', APPROVER);
    expect(r.entitlements).toBeGreaterThan(0);
    await noDoubleEntitlements();
    const vs = (await view()).versions.map((x: any) => [x.version_no, x.status]);
    expect(vs).toEqual([[4, 'approved'], [3, 'superseded'], [2, 'superseded'], [1, 'superseded']]);
  });

  let firstExport: Buffer;
  it('كشف الصرف: من الإصدار المعتمد، وإعادة التنزيل تعيد الملفّ نفسه حرفيّاً', async () => {
    const before = await ds.getRepository(CrewSalaryEntitlement).count();
    const x = await svc.exportPayments(cycleId, 'EUR', CLERK);
    expect(x).toMatchObject({ redownload: false, filename: 'CS-TESTVESSEL-202608-V4-EUR.xlsx' });
    firstExport = x.buffer;
    const y = await svc.exportPayments(cycleId, 'EUR', CLERK);
    expect(y).toMatchObject({ redownload: true, filename: x.filename });
    expect(y.buffer.equals(x.buffer)).toBe(true);
    expect(await ds.getRepository(CrewSalaryEntitlement).count()).toBe(before);
    expect((await view()).cycle.status).toBe('exported');
  });

  it('تعديلٌ بعد التصدير: الدفعة الجديدة تصرف الفرق وحده، والقديمة تُنزَّل كما هي', async () => {
    await svc.decide(cycleId, { kind: 'field_override', target_key: '9101:EUR|basic', value: '3300', reason: 'زيادةٌ معتمدة' }, CLERK);
    await ack('9101');
    await svc.submit(cycleId, 'زيادة المرتّب', CLERK);
    const v5 = await latest();
    await svc.approve(v5.id, 'اعتماد الزيادة', APPROVER);
    await noDoubleEntitlements();
    const x = await svc.exportPayments(cycleId, 'EUR', CLERK);
    const rows = XLSX.utils.sheet_to_json<any[]>(XLSX.read(x.buffer, { type: 'buffer' }).Sheets['الصرف'], { header: 1 });
    const a = rows.find((r) => r[1] === '9101')!;
    expect([a[12], a[13], a[14], a[15]]).toEqual([4750, 4450, 'CS-TESTVESSEL-202608-V4-EUR', 300]); // 3300+1200+750−500 مقابل 3000+1200+750−500
    expect(rows.some((r) => r[1] === '9102')).toBe(false); // لم تتغيّر فلا تُعاد في دفعة V5
    const v4 = (await view()).versions.find((v: any) => v.version_no === 4);
    const old = await svc.exportPayments(cycleId, 'EUR', CLERK, v4.id);
    expect(old).toMatchObject({ redownload: true, historical: false });
    expect(old.buffer.equals(firstExport)).toBe(true);
  });

  it('رفض إصدارٍ جديد بعد التصدير لا يعيد حالة الدورة إلى «معتمدة»', async () => {
    await svc.decide(cycleId, { kind: 'field_override', target_key: '9101:EUR|basic', value: '3310', reason: 'تجربة رفض' }, CLERK);
    await ack('9101');
    await svc.submit(cycleId, 'سيُرفض', CLERK);
    expect((await view()).cycle.status).toBe('submitted');
    await svc.reject((await latest()).id, 'مرفوضٌ للاختبار', APPROVER);
    expect((await view()).cycle.status).toBe('exported');
    await svc.decide(cycleId, { kind: 'field_override', target_key: '9101:EUR|basic', value: '3300', reason: 'رجوع' }, CLERK);
  });

  it('فتراتٌ متداخلة في دورتين: الاعتماد المتزامن يمرّ لأحدهما فقط', async () => {
    const c: FakeCrew = { id: '9300', name: 'Charlie, Test', rank: 'AB', section: 'final', start: 1, end: 20, rates: [1000, 400, 250] };
    const x: any = await svc.importFile(fakeCfm('Vessel X', 'EUR', [c]), 'x.xlsx', CLERK);
    const y: any = await svc.importFile(fakeCfm('Vessel Y', 'EUR', [{ ...c, section: 'monthly', start: 15, end: 31 }]), 'y.xlsx', CLERK);
    for (const id of [x.cycle_id, y.cycle_id]) {
      const e = await entry('9300', id);
      if (e.diff_hash) await svc.decide(id, { kind: 'difference_ack', target_key: e.key, hash: e.diff_hash, reason: 'اختبار التداخل' }, CLERK);
      await svc.submit(id, 'تداخل', CLERK);
    }
    const [vx, vy] = [await latest(x.cycle_id), await latest(y.cycle_id)];
    const res = await Promise.allSettled([svc.approve(vx.id, 'اعتماد x', APPROVER), svc.approve(vy.id, 'اعتماد y', APPROVER)]);
    expect(res.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(String((res.find((r) => r.status === 'rejected') as PromiseRejectedResult).reason)).toMatch(/استحقاقٌ مكرَّر/);
  });

  it('عملة دفعٍ استثنائيّة: موقوفةٌ بلا سعر، وتُحوَّل مرّةً واحدة بعد إدخاله', async () => {
    await svc.decide(cycleId, { kind: 'payment_currency', target_key: '9102:EUR', currency: 'USD', reason: 'حسابه بالدولار بطلبه الموثَّق' }, CLERK);
    let b = await entry('9102');
    expect(b).toMatchObject({ currency: 'USD', contract_currency: 'EUR', payment_currency_exception: true, eligible: false });
    expect(b.result.issues.map((i: any) => i.code)).toContain('fx_missing');
    await expect(svc.setFx('2026-08', 'EUR', '1.17', 'نشرة البنك', CLERK)).rejects.toThrow(/شاشة التقارير/);
    await svc.setFx('2026-08', 'EUR', '1.17', 'نشرة البنك', FINANCE);
    b = await entry('9102');
    expect(b.result.items.find((i: any) => i.kind === 'basic')).toMatchObject({ original_currency: 'EUR', original_amount: '1131.33', currency: 'USD', amount: '1323.66' });
    expect(b.differences.filter((d: any) => d.kind !== 'sign_off_day' && d.kind !== 'balance')).toEqual([]);
  });

  it('سعر الصرف: كتابةٌ ذرّيّة — عملتان متزامنتان لا تضيع إحداهما، ولا يُمسّ غيرهما', async () => {
    await Promise.all([
      svc.setFx('2026-09', 'EUR', '1.18', 'نشرة أ', FINANCE),
      svc.setFx('2026-09', 'EGP', '0.020833', 'نشرة ب', FINANCE),
    ]);
    const row = (await ds.query(`SELECT rates FROM exchange_rates WHERE month='2026-09'`))[0].rates;
    expect(Object.keys(row).sort()).toEqual(['EGP', 'EUR']);
    await svc.setFx('2026-09', 'EUR', '1.19', 'تحديث', FINANCE);
    const again = (await ds.query(`SELECT rates FROM exchange_rates WHERE month='2026-09'`))[0].rates;
    expect(again.EGP).toBe(row.EGP);
    await expect(svc.setFx('2026-09', 'EUR', '1.1234567', 'سبع منازل', FINANCE)).rejects.toThrow(/ستّ منازل/);
  });

  it('سجلّ التدقيق يحفظ من فعل ماذا ومتى ولماذا — ولا يُعدَّل', async () => {
    const rows = await ds.getRepository(CrewSalaryAudit).find();
    const actions = new Set(rows.map((r) => r.action));
    for (const a of ['import', 'import_duplicate', 'decision_item_review', 'decision_difference_ack', 'decision_payment_currency', 'submitted', 'approved', 'rejected', 'bank_approved', 'authorization_approved', 'export_payments', 'export_payments_redownload', 'fx_set']) {
      expect(actions.has(a)).toBe(true);
    }
    const approved = rows.find((r) => r.action === 'approved')!;
    expect(approved).toMatchObject({ user_id: APPROVER.id, user_name: 'Approver' });
    await expect(ds.query(`UPDATE crew_salary_audit SET reason = 'x' WHERE id = $1`, [approved.id])).rejects.toThrow(/إلحاقٌ فقط/);
    expect(await ds.getRepository(CrewSalaryVersion).count()).toBeGreaterThan(5);
  });
});
