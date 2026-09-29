import * as fs from 'fs';
import * as path from 'path';
import { Client } from 'pg';
import { DataSource } from 'typeorm';
import { freshDb } from '../../../test/pg/db';
import { CostItemCode } from './cost-item-code.entity';
import { CostStructureService } from './cost-structure.service';

/*
 * هجرة رموز هيكل التكاليف وخدمتها على PostgreSQL حقيقيّة (مؤقّتة، محلّيّة) — لا على الإنتاج.
 * يُشغَّل:  npx jest -c test/jest-pg.json cost-structure
 */
const UP = fs.readFileSync(path.join(__dirname, '../../../docs/cost-structure-codes-up.sql'), 'utf8');
const DOWN = fs.readFileSync(path.join(__dirname, '../../../docs/cost-structure-codes-down.sql'), 'utf8');

describe('رموز هيكل التكاليف على PostgreSQL', () => {
  let db: Awaited<ReturnType<typeof freshDb>>;
  let c: Client;
  let ds: DataSource;
  let svc: CostStructureService;

  beforeAll(async () => {
    db = await freshDb('cost_codes');
    c = new Client({ connectionString: db.url });
    await c.connect();
    // محاكاة Supabase: أدوار الوصول المباشر، وصلاحيّاتٌ افتراضيّة تمنحها كلّ جدولٍ جديد
    await c.query(`DO $r$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
    END $r$`);
    await c.query('GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role');
    await c.query('ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role');
    await c.query(UP);
    ds = new DataSource({ type: 'postgres', url: db.url, entities: [CostItemCode], synchronize: false });
    await ds.initialize();
    svc = new CostStructureService(ds.getRepository(CostItemCode));
  });
  afterAll(async () => { await ds?.destroy(); await c?.end(); await db?.drop(); });

  it('الهجرة متكرّرة الأمان: تشغيلها ثانيةً لا يغيّر شيئاً ولا يفشل', async () => {
    await expect(c.query(UP)).resolves.toBeDefined();
    const cons = (await c.query(`SELECT conname FROM pg_constraint WHERE conrelid = 'cost_item_codes'::regclass AND contype = 'c' ORDER BY 1`)).rows.map((r) => r.conname);
    expect(cons).toEqual(['cost_item_codes_code_chk', 'cost_item_codes_locked_chk']);
  });

  it('RLS مفعّلة بلا FORCE، ولا صلاحيّة لأدوار الوصول المباشر', async () => {
    const r = (await c.query(`SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid = 'cost_item_codes'::regclass`)).rows[0];
    expect(r).toEqual({ relrowsecurity: true, relforcerowsecurity: false });
    const grants = (await c.query(`SELECT grantee FROM information_schema.role_table_grants WHERE table_name = 'cost_item_codes' AND grantee IN ('anon','authenticated','service_role','PUBLIC')`)).rows;
    expect(grants).toEqual([]);
  });

  it('القيد في القاعدة نفسها يرفض رمزاً غير A/D/F ويرفض السطور الثابتة', async () => {
    await expect(c.query(`INSERT INTO cost_item_codes (item_key, code) VALUES ('broker', 'B')`)).rejects.toThrow(/cost_item_codes_code_chk/);
    await expect(c.query(`INSERT INTO cost_item_codes (item_key, code) VALUES ('fuel', 'A')`)).rejects.toThrow(/cost_item_codes_locked_chk/);
  });

  it('الخدمة تحفظ وتحدّث وتُرجع إلى الافتراضيّ، والكيان يطابق الجدول', async () => {
    const a = await svc.set('broker', 'd', 'admin-1');
    expect(a).toMatchObject({ item_key: 'broker', code: 'D', updated_by: 'admin-1' });
    const b = await svc.set('broker', 'A', 'admin-2');
    expect(b).toMatchObject({ code: 'A', updated_by: 'admin-2' });
    expect(b.updated_at.getTime()).toBeGreaterThanOrEqual(a.updated_at.getTime());
    await svc.set('egyPort', 'D', 'admin-1');
    expect((await svc.list()).map((r) => [r.item_key, r.code])).toEqual([['broker', 'A'], ['egyPort', 'D']]);
    await svc.clear('broker');
    expect((await svc.list()).map((r) => r.item_key)).toEqual(['egyPort']);
  });

  it('الخدمة ترفض قبل القاعدة: رمزٌ خاطئ، سطرٌ ثابت، مفتاحٌ غير صالح', async () => {
    await expect(svc.set('broker', 'B', 'x')).rejects.toThrow(/A أو D أو F/);
    await expect(svc.set('salaries', 'A', 'x')).rejects.toThrow(/سطورٌ ثابتة/);
    await expect(svc.set("x'; DROP TABLE cost_item_codes; --", 'A', 'x')).rejects.toThrow(/غير صالح/);
    await expect(svc.clear('purchases')).rejects.toThrow(/سطورٌ ثابتة/);
  });

  it('التراجع يرفض حذف جدولٍ فيه ربطٌ محفوظ إلّا بإقرارٍ صريح، ثمّ يحذفه', async () => {
    await expect(c.query(DOWN)).rejects.toThrow(/GATE FAILED: cost_item_codes فيه 1 صفّاً/);
    await c.query('ROLLBACK').catch(() => undefined);
    await c.query(`BEGIN; SET LOCAL cost_codes.force_drop = 'yes'; ${DOWN.replace(/^\s*BEGIN;\s*$/m, '')}`);
    const t = (await c.query(`SELECT to_regclass('public.cost_item_codes') AS t`)).rows[0].t;
    expect(t).toBeNull();
    // والتراجع على قاعدةٍ بلا الجدول لا يفشل
    await expect(c.query(DOWN)).resolves.toBeDefined();
  });
});
