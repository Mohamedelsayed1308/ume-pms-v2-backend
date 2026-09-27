import * as fs from 'fs';
import * as path from 'path';
import { Client } from 'pg';
import { DataSource } from 'typeorm';
import { freshDb } from '../../../test/pg/db';
import { CREW_SALARY_ENTITIES } from './crew-salary.entity';

/*
 * هجرة مرتّبات الأطقم على PostgreSQL حقيقيّة (مؤقّتة، محلّيّة) — لا على الإنتاج.
 * يُشغَّل:  npx jest -c test/jest-pg.json
 */
const UP = fs.readFileSync(path.join(__dirname, '../../../docs/crew-salaries-up.sql'), 'utf8');
const DOWN = fs.readFileSync(path.join(__dirname, '../../../docs/crew-salaries-down.sql'), 'utf8');

describe('هجرة crew-salaries على PostgreSQL', () => {
  let db: Awaited<ReturnType<typeof freshDb>>;
  let c: Client;
  const notices: string[] = [];

  beforeAll(async () => {
    db = await freshDb('crew_mig');
    c = new Client({ connectionString: db.url });
    c.on('notice', (n) => notices.push(n.message || ''));
    await c.connect();
  });
  afterAll(async () => { await c?.end(); await db?.drop(); });

  const tables = async () => (await c.query(`SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name LIKE 'crew_salary_%' ORDER BY 1`)).rows.map((r) => r.table_name);

  it('الصعود ينشئ الجداول العشرة، وإعادته آمنة', async () => {
    await c.query(UP);
    expect(await tables()).toHaveLength(10);
    await c.query(UP);
    expect(await tables()).toHaveLength(10);
    expect(notices.some((n) => n.includes('بعد الهجرة'))).toBe(true);
  });

  it('المفاتيح uuid بقيمةٍ افتراضيّة gen_random_uuid() في كلّ جدول', async () => {
    const r = await c.query(`SELECT table_name, column_default FROM information_schema.columns
      WHERE table_schema='public' AND table_name LIKE 'crew_salary_%' AND column_name='id'`);
    expect(r.rows).toHaveLength(10);
    for (const row of r.rows) expect(row.column_default).toBe('gen_random_uuid()');
  });

  it('تطابق الكيانات والهجرة: كلّ عمودٍ في الكيان موجودٌ بنوعه وقابليّته للفراغ', async () => {
    const ds = new DataSource({ type: 'postgres', url: db.url, entities: CREW_SALARY_ENTITIES, synchronize: false });
    await ds.initialize();
    try {
      const cols = await c.query(`SELECT table_name, column_name, data_type, is_nullable, character_maximum_length, numeric_precision, numeric_scale
        FROM information_schema.columns WHERE table_schema='public' AND table_name LIKE 'crew_salary_%'`);
      const at = (t: string, n: string) => cols.rows.find((r) => r.table_name === t && r.column_name === n);
      const pgType: Record<string, string> = {
        uuid: 'uuid', varchar: 'character varying', integer: 'integer', text: 'text', jsonb: 'jsonb', bytea: 'bytea',
        boolean: 'boolean', date: 'date', timestamptz: 'timestamp with time zone', numeric: 'numeric',
      };
      const problems: string[] = [];
      for (const m of ds.entityMetadatas) {
        for (const col of m.columns) {
          const row = at(m.tableName, col.databaseName);
          const t = String(col.type === Date ? 'timestamptz' : col.type);
          if (!row) { problems.push(`${m.tableName}.${col.databaseName} مفقود في الهجرة`); continue; }
          if (row.data_type !== pgType[t]) problems.push(`${m.tableName}.${col.databaseName}: ${row.data_type} ≠ ${t}`);
          if ((row.is_nullable === 'YES') !== !!col.isNullable) problems.push(`${m.tableName}.${col.databaseName}: قابليّة الفراغ`);
          if (col.length && Number(row.character_maximum_length) !== Number(col.length)) problems.push(`${m.tableName}.${col.databaseName}: الطول`);
        }
        const inEntity = new Set(m.columns.map((x) => x.databaseName));
        for (const r of cols.rows.filter((x) => x.table_name === m.tableName)) {
          if (!inEntity.has(r.column_name)) problems.push(`${m.tableName}.${r.column_name} في الهجرة لا في الكيان`);
        }
        // الفهارس بأسمائها
        for (const idx of m.indices) {
          const e = await c.query(`SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname=$1`, [idx.name]);
          if (!e.rowCount) problems.push(`الفهرس ${idx.name} غير موجود`);
        }
      }
      expect(problems).toEqual([]);
    } finally { await ds.destroy(); }
  });

  it('سجلّ التدقيق إلحاقٌ فقط', async () => {
    const r = await c.query(`INSERT INTO crew_salary_audit (entity, action) VALUES ('t', 'probe') RETURNING id`);
    await expect(c.query(`UPDATE crew_salary_audit SET action='x' WHERE id=$1`, [r.rows[0].id])).rejects.toThrow(/إلحاقٌ فقط/);
    await expect(c.query(`DELETE FROM crew_salary_audit WHERE id=$1`, [r.rows[0].id])).rejects.toThrow(/إلحاقٌ فقط/);
  });

  it('لقطة الإصدار لا تُعدَّل ولا يُحذف — والحالة وحدها تتقدّم', async () => {
    const cy = await c.query(`INSERT INTO crew_salary_cycles (vessel, month) VALUES ('Probe', '2026-08') RETURNING id`);
    const v = await c.query(`INSERT INTO crew_salary_versions (cycle_id, version_no, snapshot, content_hash) VALUES ($1, 1, '{"a":1}', 'h') RETURNING id`, [cy.rows[0].id]);
    await c.query(`UPDATE crew_salary_versions SET status='approved' WHERE id=$1`, [v.rows[0].id]);
    await expect(c.query(`UPDATE crew_salary_versions SET snapshot='{"a":2}' WHERE id=$1`, [v.rows[0].id])).rejects.toThrow(/لا تُعدَّل/);
    await expect(c.query(`DELETE FROM crew_salary_versions WHERE id=$1`, [v.rows[0].id])).rejects.toThrow(/لا يُحذف/);
  });

  it('الاستحقاق الساري لا يتكرّر، والمنتهي لا يمنع', async () => {
    const cy = (await c.query(`SELECT id FROM crew_salary_cycles LIMIT 1`)).rows[0].id;
    const v = (await c.query(`SELECT id FROM crew_salary_versions LIMIT 1`)).rows[0].id;
    const ins = (active: boolean) => c.query(`INSERT INTO crew_salary_entitlements (version_id, cycle_id, crew_id, currency, kind, amount, entitlement_key, active)
      VALUES ($1, $2, '527', 'EUR', 'basic', 1131.33, 'k1', $3)`, [v, cy, active]);
    await ins(true);
    await expect(ins(true)).rejects.toThrow(/UQ_crew_salary_entitlements_active/);
    await ins(false);
  });

  it('حسابٌ معتمدٌ واحد لكلّ بحّار، والملفّ المرفوع لا يتكرّر', async () => {
    const acc = (fp: string, status: string) => c.query(`INSERT INTO crew_salary_bank_accounts (crew_id, fingerprint, status) VALUES ('527', $1, $2)`, [fp, status]);
    await acc('a', 'approved');
    await expect(acc('b', 'approved')).rejects.toThrow(/UQ_crew_salary_bank_accounts_approved/);
    await acc('b', 'imported');
    await expect(acc('b', 'imported')).rejects.toThrow(/UQ_crew_salary_bank_accounts_fp/);
    const f = () => c.query(`INSERT INTO crew_salary_files (kind, name, sha256) VALUES ('email', 'x.msg', 'abc')`);
    await f();
    await expect(f()).rejects.toThrow(/UQ_crew_salary_files_top_sha/);
  });

  it('النزول: البوّابة ترفض الحذف مع وجود صفوف، وتقبله بقرارٍ صريح', async () => {
    await expect(c.query(DOWN)).rejects.toThrow(/GATE FAILED/);
    await c.query('ROLLBACK');
    expect(await tables()).toHaveLength(10);
    const forced = DOWN.replace('BEGIN;', "BEGIN;\nSET LOCAL crew_salary.force_drop = 'yes';");
    await c.query(forced);
    expect(await tables()).toHaveLength(0);
    const fns = await c.query(`SELECT proname FROM pg_proc WHERE proname LIKE 'crew_salary_%'`);
    expect(fns.rowCount).toBe(0);
    // ثمّ صعودٌ ونزولٌ على قاعدةٍ فارغة بلا قرار
    await c.query(UP);
    await c.query(DOWN);
    expect(await tables()).toHaveLength(0);
  });
});
