import * as fs from 'fs';
import * as path from 'path';
import * as XLSX from 'xlsx';
import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { freshDb } from '../../../test/pg/db';
import { ExchangeRate } from '../exchange-rates/exchange-rate.entity';
import { ExchangeRatesService } from '../exchange-rates/exchange-rates.service';
import type { ScreenAuthzService } from '../../common/screen-authz.service';
import { CREW_SALARY_ENTITIES, CrewSalaryFile } from './crew-salary.entity';
import { CrewSalariesService, type Actor } from './crew-salaries.service';

/*
 * عيّنة أغسطس الحقيقيّة إلى قاعدةٍ مؤقّتة — تُقرأ من مسارٍ محلّيّ ولا تدخل Git.
 *   CREW_SAMPLE_DIR=<dir> npm run test:pg -- crew-salaries.sample
 * وبدونه يُتخطّى. ولا يطبع أسماءً ولا أرقام حسابات.
 * سعر 1.17 هنا للاختبار وحده (هو سعر كشف توزيع اللاشينج) — لا سعرٌ معتمد لأغسطس.
 */
const DIR = process.env.CREW_SAMPLE_DIR || '';
const ready = !!DIR && ['aug.msg', 'cfm_usd.xlsx', 'cfm_eur.xlsx'].every((f) => fs.existsSync(path.join(DIR, f)));
const d = ready ? describe : describe.skip;
const UP = fs.readFileSync(path.join(__dirname, '../../../docs/crew-salaries-up.sql'), 'utf8');
const USER: Actor = { id: randomUUID(), email: 'clerk@test.local', full_name: 'Clerk' };
const OWNER: Actor = { id: randomUUID(), email: 'owner@test.local', full_name: 'Owner' };
const authz = { can: async (id: string, href: string) => href === '/dashboard/reports' && id === OWNER.id } as unknown as ScreenAuthzService;

d('عيّنة أغسطس في القاعدة المؤقّتة', () => {
  let db: Awaited<ReturnType<typeof freshDb>>;
  let ds: DataSource;
  let svc: CrewSalariesService;
  let cycleId: string;
  const read = (f: string) => fs.readFileSync(path.join(DIR, f));
  const env = process.env.CREW_SALARY_APPROVER_USER_ID;

  beforeAll(async () => {
    db = await freshDb('crew_sample');
    ds = new DataSource({ type: 'postgres', url: db.url, entities: [...CREW_SALARY_ENTITIES, ExchangeRate], synchronize: false });
    await ds.initialize();
    await ds.query(UP);
    await ds.query(`CREATE TABLE exchange_rates (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), month varchar UNIQUE NOT NULL, rates jsonb, updated_at timestamp NOT NULL DEFAULT now())`);
    svc = new CrewSalariesService(ds, new ExchangeRatesService(ds.getRepository(ExchangeRate)), authz);
    process.env.CREW_SALARY_APPROVER_USER_ID = OWNER.id;
  });
  afterAll(async () => {
    if (env === undefined) delete process.env.CREW_SALARY_APPROVER_USER_ID; else process.env.CREW_SALARY_APPROVER_USER_ID = env;
    await ds?.destroy(); await db?.drop();
  });

  it('الرسالة ثمّ تصديرا CFM إلى الدورة نفسها — وPDF التوزيع مُستخرَج، والهويّة لا', async () => {
    const m: any = await svc.importFile(read('aug.msg'), 'GT-CRW _ Salary of Aug_ 2026.msg', USER);
    expect(m.inference).toMatchObject({ vessel: 'Gubal Trader', month: '2026-08' });
    const st = (s: string) => m.attachments.filter((a: any) => a.status === s).length;
    // مستخرَج: ٣ جداول + PDF التوزيع · يدويّ: ٤ PDF ممسوحة + صورة · محفوظ: ٧ هويّة/عقود + ورقة النشاط
    expect([st('extracted'), st('needs_manual'), st('stored'), st('ignored')]).toEqual([4, 5, 8, 1]);
    expect(m.attachments.find((a: any) => /LB/.test(a.name)).meta).toMatchObject({ pdf_kind: 'lashing_distribution', rows: 17, rate: '1.17' });
    const u: any = await svc.importFile(read('cfm_usd.xlsx'), 'cfm_usd.xlsx', USER);
    const e: any = await svc.importFile(read('cfm_eur.xlsx'), 'cfm_eur.xlsx', USER);
    expect(new Set([m.cycle_id, u.cycle_id, e.cycle_id]).size).toBe(1);
    cycleId = m.cycle_id;
    expect((await svc.importFile(read('aug.msg'), 'again.msg', USER) as any).duplicate).toBe(true);
    expect(await ds.getRepository(CrewSalaryFile).count()).toBe(1 + 18 + 2);
  }, 180_000);

  it('العرض: ٣٢ حالة، والملاحظة معلّقة، وتعارض 379 مع PDF التوزيع ظاهر', async () => {
    const v: any = await svc.view(cycleId, USER);
    expect(v.entries).toHaveLength(32);
    expect(v.blocking).toEqual([]);
    expect(v.unresolved.map((x: any) => [x.kind, !!x.resolution])).toEqual([['note', false]]);
    expect(v.complete).toBe(false);
    const e = (id: string) => v.entries.find((x: any) => x.crew_id === id);
    expect(e('527').differences.find((x: any) => x.kind === 'sign_off_day').diff).toBe('-14.13');
    expect(e('607').differences.find((x: any) => x.kind === 'sign_off_day').diff).toBe('-50.50');
    expect(e('1074').result.items.find((i: any) => i.kind === 'sign_on_settlement').counted).toBe(false);
    expect(e('379').source_conflicts).toEqual([expect.objectContaining({ email: '418.76', other: '418.86' })]);
    expect(v.unmatched.lashing_pdf.map((x: any) => x.row.eur)).toEqual(['47.73']);
    const sync = await svc.syncBankAccounts(cycleId, USER);
    expect(sync.created).toBeGreaterThan(10);
    expect((await svc.syncBankAccounts(cycleId, USER)).created).toBe(0);
  }, 180_000);

  it('مستحقّ الكابتن خارج CFM: من الملاحظة إلى حالةٍ تكميليّة ثمّ حسابٍ فاعتمادٍ فكشف صرف — مرّةً واحدة', async () => {
    const v: any = await svc.view(cycleId, USER);
    const note = v.unresolved.find((x: any) => x.kind === 'note');
    // رقمٌ تجريبيّ لسجلّ البحّار — في التشغيل الحقيقيّ يُدخَل من سجلّه المؤكَّد، لا يُختلق
    await expect(svc.decide(cycleId, { kind: 'supplementary', target_key: note.key, supplementary: { crew_id: '', name: 'Sample, Captain', currency: 'EUR', amount: '47.73', kind: 'lashing' }, reason: 'ملاحظة الرسالة' }, USER)).rejects.toThrow(/لا يُختلق/);
    await svc.decide(cycleId, { kind: 'supplementary', target_key: note.key, supplementary: { crew_id: '990001', name: 'Sample, Captain', currency: 'EUR', amount: '47.73', kind: 'lashing' }, reason: 'ملاحظة الرسالة + كشف توزيع اللاشينج (سطر الكابتن)' }, USER);
    let s: any = await svc.view(cycleId, USER);
    expect(s.unresolved.every((x: any) => x.resolution)).toBe(true);
    const cap = s.entries.find((x: any) => x.crew_id === '990001');
    expect(cap).toMatchObject({ key: '990001:EUR', section: 'supplementary' });
    expect(cap.result.items.map((i: any) => [i.kind, i.amount, i.review])).toEqual([['lashing', '47.73', 'pending']]);
    await svc.decide(cycleId, { kind: 'item_review', target_key: cap.extras[0].key, decision: 'accepted' }, USER);
    const acc = await svc.addBankAccount({ crew_id: '990001', beneficiary: 'Sample Captain', bank: 'Test Bank', iban: 'HR00TEST0000000000001', reason: 'بيانات اختبار' }, USER, cycleId);
    await svc.reviewBankAccount(acc.id, { decision: 'approved', beneficiary_is_seafarer: true, reason: 'اختبار' }, OWNER, cycleId);
    const sub: any = await svc.submit(cycleId, 'مستحقّ الكابتن وحده', USER, ['990001:EUR']);
    expect(sub.entries).toBe(1);
    expect(sub.excluded.length).toBe(32);
    s = await svc.view(cycleId, USER);
    await svc.approve(s.versions[0].id, 'اعتماد مستحقّ الكابتن', OWNER);
    const x = await svc.exportPayments(cycleId, 'EUR', USER);
    const rows = XLSX.utils.sheet_to_json<any[]>(XLSX.read(x.buffer, { type: 'buffer' }).Sheets['الصرف'], { header: 1 });
    const data = rows.filter((r) => typeof r[0] === 'number');
    expect(data.map((r) => [r[1], r[15], r[16]])).toEqual([['990001', 'كامل', 47.73]]); // نوع الصفّ ثمّ ما خرج في الدفعة
    expect(rows.find((r) => r[0] === 'النطاق')![1]).toMatch(/جزئيّة/);
    // مرّةً واحدة: لا يُقدَّم ثانيةً ما دام لم يتغيّر
    await expect(svc.submit(cycleId, 'مكرّر', USER, ['990001:EUR'])).rejects.toThrow(/غير جاهزة/);
  }, 240_000);

  it('أغسطس بسعر اختبارٍ 1.17: السلف بعملتها الأصليّة وتفسير الفرق عن CFM سلفةً سلفة', async () => {
    await svc.setFx('2026-08', 'EUR', '1.17', 'سعر اختبار — كشف توزيع اللاشينج', OWNER);
    const v: any = await svc.view(cycleId, USER);
    const adv = v.entries.filter((e: any) => e.currency === 'USD').flatMap((e: any) => e.result.items.filter((i: any) => i.kind === 'cash_advance').map((i: any) => [e.crew_id, i.original_currency, i.original_amount, i.amount, i.source]));
    // كلّ سلفةٍ مربوطةٍ بكشف الصرف تبقى باليورو أصلاً وتُحوَّل مرّةً واحدة؛ وغير المربوطة كما صدّرها CFM بالدولار
    expect(adv.every((a: any[]) => (a[4] === 'attachment' && a[1] === 'EUR') || (a[4] === 'cfm' && a[1] === 'USD'))).toBe(true);
  }, 180_000);
});
