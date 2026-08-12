import { DataSource } from 'typeorm';
import { P11A_UP, P11A_DOWN } from '../../migrations/p11a-accounting-foundation';
import * as C from './accounting.constants';
import { LegalEntity } from './entities/legal-entity.entity';
import { CostCenter } from './entities/cost-center.entity';
import { AccountingAccount } from './entities/accounting-account.entity';
import { Journal } from './entities/journal.entity';
import { FiscalYear } from './entities/fiscal-year.entity';
import { FiscalPeriod } from './entities/fiscal-period.entity';
import { AccountingFxRate } from './entities/accounting-fx-rate.entity';
import { JournalEntry } from './entities/journal-entry.entity';
import { JournalLine } from './entities/journal-line.entity';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * حارس تطابق المخطط — الدرس المكلف من R3A.1
 *
 * TypeORM يوفّق القيود والمفاتيح والفهارس **بالاسم**، ويُسقِط من قاعدة البيانات
 * كل ما لا يجده في البيانات الوصفية عند أي مزامنة. اسم في الهجرة لا يقابله اسم
 * في الكيان = ضمان نزاهة يعيش حتى أول مزامنة ثم يختفي بصمت.
 *
 * هذا الاختبار يجعل ذلك الانحراف **مستحيل الوصول إلى main**.
 * ═══════════════════════════════════════════════════════════════════════════
 */
describe('P1.1A · تطابق الهجرة مع الكيانات', () => {
  const ENTITIES = [
    LegalEntity, CostCenter, AccountingAccount, Journal,
    FiscalYear, FiscalPeriod, AccountingFxRate, JournalEntry, JournalLine,
  ];
  const SQL = P11A_UP.join('\n');

  const build = async () => {
    const ds = new DataSource({
      type: 'postgres',
      url: 'postgresql://u:p@h:5432/d',   // لا اتصال — buildMetadatas وحدها
      entities: ENTITIES as any,
      synchronize: false,
    });
    await (ds as any).buildMetadatas();
    return ds;
  };

  const names = (re: RegExp): string[] => {
    const out: string[] = [];
    for (const m of SQL.matchAll(re)) out.push(m[1]);
    return [...new Set(out)].sort();
  };

  it('1. الجداول التسعة موجودة في الهجرة وفي الكيانات — لا زيادة ولا نقصان', async () => {
    const inSql = names(/CREATE TABLE IF NOT EXISTS (\w+)/g);
    const ds = await build();
    const inMeta = ds.entityMetadatas.map((m) => m.tableName).sort();
    expect(inSql).toEqual(inMeta);
    expect(inSql.length).toBe(9);
  });

  it('2. كل قيد CHECK في الهجرة معلَن في كيانه بالاسم نفسه', async () => {
    const inSql = names(/ADD CONSTRAINT (\w+) CHECK/g);
    const ds = await build();
    const inMeta = [...new Set(ds.entityMetadatas.flatMap((m) => m.checks.map((c: any) => c.name)))].sort();
    expect(inMeta).toEqual(inSql);
  });

  it('3. كل مفتاح خارجي في الهجرة معلَن في كيانه بالاسم نفسه', async () => {
    const inSql = names(/ADD CONSTRAINT (\w+) FOREIGN KEY/g);
    const ds = await build();
    const inMeta = [...new Set(ds.entityMetadatas.flatMap((m) => m.foreignKeys.map((f: any) => f.name)))].sort();
    expect(inMeta).toEqual(inSql);
  });

  it('4. كل فهرس في الهجرة معلَن في كيانه بالاسم نفسه', async () => {
    const inSql = names(/CREATE (?:UNIQUE )?INDEX IF NOT EXISTS (\w+)/g);
    const ds = await build();
    const inMeta = [...new Set(ds.entityMetadatas.flatMap((m) => [
      ...m.indices.map((i: any) => i.name),
      ...m.uniques.map((u: any) => u.name),
    ]))].sort();
    expect(inMeta).toEqual(inSql);
  });

  it('5. الفهارس الجزئية تحمل شرط WHERE نفسه في الطرفين', async () => {
    const ds = await build();
    const meta = ds.getMetadata(JournalEntry);
    const evt = meta.indices.find((i: any) => i.name === C.UQ_JE_EVENT)!;
    expect(evt.isUnique).toBe(true);
    expect(evt.where).toBe("source_id IS NOT NULL AND status <> 'void'");
    expect(SQL).toContain(`ON journal_entries (legal_entity_id, accounting_event_type, source_type, source_id) WHERE source_id IS NOT NULL AND status <> 'void'`);
    // نوع الحدث جزء من المفتاح: الاستحقاق والتسوية والعكس أحداث مشروعة لمستند واحد
    expect(evt.columns.map((c: any) => c.databaseName)).toContain('accounting_event_type');
  });

  it('6. التعابير الحاكمة مكتوبة مرة واحدة ومشتركة بين الهجرة والكيان', () => {
    expect(SQL).toContain(C.CHK_JL_ONE_SIDE_EXPR);
    expect(SQL).toContain(C.CHK_JE_POSTED_BALANCED_EXPR);
    expect(SQL).toContain(C.CHK_JL_FOREIGN_NEEDS_FX_EXPR);
    expect(SQL).toContain(C.CHK_JL_EUR_RATE_ONE_EXPR);
  });

  it('7. الهجرة لا تمسّ أي جدول أعمال قائم — صفر ALTER خارج جداولها التسعة', () => {
    const own = new Set(names(/CREATE TABLE IF NOT EXISTS (\w+)/g));
    for (const m of SQL.matchAll(/ALTER TABLE (\w+)/g)) expect(own.has(m[1])).toBe(true);

    // ولا سطر بيانات واحد: كل تعليمة تبدأ بـDDL. الفحص على أول كلمة في كل تعليمة
    // لا على النص كله — "BEFORE UPDATE" داخل مشغّل ليست تحديث بيانات.
    for (const stmt of P11A_UP) {
      const head = stmt.trim().split(/\s+/)[0].toUpperCase();
      expect(['CREATE', 'DO', 'DROP', 'ALTER']).toContain(head);
      if (head === 'DROP') expect(stmt).toMatch(/^DROP TRIGGER IF EXISTS/);
    }
  });

  it('7b. الجداول التسعة كلها محميّة من الوصول المباشر بمفتاح عام', () => {
    const tables = names(/CREATE TABLE IF NOT EXISTS (\w+)/g);

    const rls = P11A_UP
      .filter((s) => /ENABLE ROW LEVEL SECURITY$/.test(s.trim()))
      .map((s) => s.match(/^ALTER TABLE (\w+)/)![1]).sort();
    expect(rls).toEqual(tables);

    // ⚠️ REVOKE ليس زائداً عن RLS: RLS لا يحكم TRUNCATE إطلاقاً، وTRUNCATE
    //    لا يُشغّل مشغّلات الصفوف — فبدون REVOKE يُمحى دفتر مُرحَّل بأمر واحد.
    const block = P11A_UP.find((s) => s.includes('REVOKE ALL ON %I FROM %I'));
    expect(block).toBeTruthy();
    for (const t of tables) expect(block).toContain(`'${t}'`);
    expect(block).toContain(`ARRAY['anon','authenticated']`);
    // مشروط بوجود الدور — وإلا أسقطت الهجرة نفسها خارج Supabase
    expect(block).toContain('IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r)');
  });

  it('8. التراجع يُسقط جداول P1.1A وحدها — لا شيء من PMS', () => {
    const own = new Set(P11A_UP.join('\n').match(/CREATE TABLE IF NOT EXISTS (\w+)/g)!
      .map((s) => s.replace('CREATE TABLE IF NOT EXISTS ', '')));
    const dropped = P11A_DOWN.join('\n').match(/DROP TABLE IF EXISTS (\w+)/g)!
      .map((s) => s.replace('DROP TABLE IF EXISTS ', ''));
    expect(dropped.length).toBe(9);
    for (const t of dropped) expect(own.has(t)).toBe(true);
    // الأبناء قبل الآباء — وإلا فشل التراجع على المفاتيح الخارجية
    expect(dropped.indexOf('journal_lines')).toBeLessThan(dropped.indexOf('journal_entries'));
    expect(dropped.indexOf('journal_entries')).toBeLessThan(dropped.indexOf('legal_entities'));
  });

  it('9. مشغّلا الثبات موجودان — الحماية في المحرّك لا في التطبيق وحده', () => {
    expect(SQL).toContain('CREATE TRIGGER trg_je_immutable BEFORE UPDATE OR DELETE ON journal_entries');
    expect(SQL).toContain('CREATE TRIGGER trg_jl_immutable BEFORE INSERT OR UPDATE OR DELETE ON journal_lines');
    // الانتقال الوحيد المسموح على قيد مُرحَّل هو التوسيم بالعكس
    expect(SQL).toContain("OLD.status = 'posted' AND NEW.status = 'reversed'");
    expect(SQL).toContain('CREATE CONSTRAINT TRIGGER trg_je_balanced_deferred');
    expect(SQL).toContain('DEFERRABLE INITIALLY DEFERRED');
    expect(SQL).toContain('CREATE TRIGGER trg_je_period_guard BEFORE INSERT OR UPDATE ON journal_entries');

    // ⚠️ OLD غير مُسنَد داخل INSERT — أي COALESCE بين NEW وOLD يرفع خطأ وقت
    //    التشغيل عند أول إدراج سطر، لا عند إنشاء المشغّل.
    expect(SQL).not.toMatch(/COALESCE\(\s*NEW\s*,\s*OLD\s*\)/);
    expect(SQL).not.toMatch(/COALESCE\(\s*NEW\.\w+\s*,\s*OLD\.\w+\s*\)/);
    expect(SQL).toContain("IF (TG_OP = 'DELETE') THEN eid := OLD.entry_id; ELSE eid := NEW.entry_id; END IF;");
  });
});
