import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { freshDb } from '../../../test/pg/db';
import { ExchangeRate } from '../exchange-rates/exchange-rate.entity';
import { ExchangeRatesService } from '../exchange-rates/exchange-rates.service';
import { CREW_SALARY_ENTITIES, CrewSalaryFile } from './crew-salary.entity';
import { CrewSalariesService, type Actor } from './crew-salaries.service';

/*
 * عيّنة أغسطس الحقيقيّة إلى قاعدةٍ مؤقّتة — تُقرأ من مسارٍ محلّيّ ولا تدخل Git.
 *   CREW_SAMPLE_DIR=<dir> npx jest -c test/jest-pg.json crew-salaries.sample
 * وبدونه يُتخطّى. ولا يطبع أسماءً ولا أرقام حسابات.
 */
const DIR = process.env.CREW_SAMPLE_DIR || '';
const ready = !!DIR && ['aug.msg', 'cfm_usd.xlsx', 'cfm_eur.xlsx'].every((f) => fs.existsSync(path.join(DIR, f)));
const d = ready ? describe : describe.skip;
const UP = fs.readFileSync(path.join(__dirname, '../../../docs/crew-salaries-up.sql'), 'utf8');
const USER: Actor = { id: randomUUID(), email: 'clerk@test.local', full_name: 'Clerk' };

d('عيّنة أغسطس في القاعدة المؤقّتة', () => {
  let db: Awaited<ReturnType<typeof freshDb>>;
  let ds: DataSource;
  let svc: CrewSalariesService;
  const read = (f: string) => fs.readFileSync(path.join(DIR, f));

  beforeAll(async () => {
    db = await freshDb('crew_sample');
    ds = new DataSource({ type: 'postgres', url: db.url, entities: [...CREW_SALARY_ENTITIES, ExchangeRate], synchronize: false });
    await ds.initialize();
    await ds.query(UP);
    await ds.query(`CREATE TABLE exchange_rates (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), month varchar UNIQUE NOT NULL, rates jsonb, updated_at timestamp NOT NULL DEFAULT now())`);
    svc = new CrewSalariesService(ds, new ExchangeRatesService(ds.getRepository(ExchangeRate)));
  });
  afterAll(async () => { await ds?.destroy(); await db?.drop(); });

  it('الرسالة ثمّ تصديرا CFM إلى الدورة نفسها — بالاستنتاج من المحتوى', async () => {
    const m: any = await svc.importFile(read('aug.msg'), 'GT-CRW _ Salary of Aug_ 2026.msg', USER);
    expect(m.inference).toMatchObject({ vessel: 'Gubal Trader', month: '2026-08' });
    expect(m.inference.conflicts).toEqual([]);
    const st = (s: string) => m.attachments.filter((a: any) => a.status === s).length;
    // ورقة نشاط اللاشينج غير معروفة البنية ⇒ يدويّ (مبالغها من نصّ الرسالة)
    expect([st('extracted'), st('needs_manual'), st('ignored')]).toEqual([3, 14, 1]);
    expect(m.attachments.find((a: any) => /lashing/i.test(a.name) && a.class === 'spreadsheet').flags).toEqual(['unrecognized_sheet']);
    const u: any = await svc.importFile(read('cfm_usd.xlsx'), 'cfm_usd.xlsx', USER);
    const e: any = await svc.importFile(read('cfm_eur.xlsx'), 'cfm_eur.xlsx', USER);
    expect(new Set([m.cycle_id, u.cycle_id, e.cycle_id]).size).toBe(1);
    const dup: any = await svc.importFile(read('aug.msg'), 'again.msg', USER);
    expect(dup.duplicate).toBe(true);
    expect(await ds.getRepository(CrewSalaryFile).count()).toBe(1 + 18 + 2);
  });

  it('العرض: ٣٢ حالة، والفروق المعروفة، والملاحظة معلّقة، ولا تقديم قبل المراجعة', async () => {
    const [c] = await ds.query(`SELECT id FROM crew_salary_cycles`);
    const v: any = await svc.view(c.id, USER);
    expect(v.entries).toHaveLength(32);
    expect(v.blocking).toEqual([]);
    expect(v.totals.USD.count + v.totals.EUR.count).toBe(32);
    const e = (id: string) => v.entries.find((x: any) => x.crew_id === id);
    expect(e('527').differences.find((x: any) => x.kind === 'sign_off_day').diff).toBe('-14.13');
    expect(e('607').differences.find((x: any) => x.kind === 'sign_off_day').diff).toBe('-50.50');
    expect(e('1074').result.items.find((i: any) => i.kind === 'sign_on_settlement').counted).toBe(false);
    expect(v.unmatched.notes.map((n: any) => n.amount)).toEqual(['47.73']);
    await expect(svc.submit(c.id, 'تجربة', USER)).rejects.toThrow(/لم تكتمل/);
    const sync = await svc.syncBankAccounts(c.id, USER);
    expect(sync.created).toBeGreaterThan(10);
    const again = await svc.syncBankAccounts(c.id, USER);
    expect(again.created).toBe(0);
    const accounts = await ds.query(`SELECT status, count(*)::int n FROM crew_salary_bank_accounts GROUP BY 1`);
    expect(accounts).toEqual([{ status: 'imported', n: sync.created }]);
  });
});
