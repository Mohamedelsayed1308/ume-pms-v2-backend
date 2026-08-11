import * as fs from 'fs';
import * as path from 'path';
import { DataSource } from 'typeorm';
import { isProduction, shouldSynchronize, assertNoAutoDdlInProduction } from './schema-policy';

describe('R3A.1 · سياسة المخطط', () => {
  it('1. الإنتاج: لا مزامنة تلقائية', () => {
    expect(shouldSynchronize('production')).toBe(false);
    expect(isProduction('production')).toBe(true);
  });

  it('2. التطوير والاختبار: المزامنة متاحة', () => {
    for (const env of ['development', 'dev', 'test']) {
      expect(shouldSynchronize(env)).toBe(true);
      expect(isProduction(env)).toBe(false);
    }
  });

  it('3. fail-closed: البيئة غير المعلَنة تُعامَل إنتاجاً', () => {
    // متغيّر مفقود أو فارغ أو مجهول ⇒ لا DDL تلقائي. لا fallback غامض.
    for (const env of [undefined, '', '   ', 'staging', 'prod', 'PRODUCTION', 'anything']) {
      expect(shouldSynchronize(env)).toBe(false);
    }
  });

  it('4. المطابقة غير حسّاسة لحالة الأحرف والمسافات', () => {
    expect(shouldSynchronize(' Development ')).toBe(true);
    expect(shouldSynchronize('TEST')).toBe(true);
  });

  it('5. الحاجز يمنع تسرّب المزامنة إلى الإنتاج', () => {
    expect(() => assertNoAutoDdlInProduction('production', true)).toThrow(/SCHEMA SAFETY/);
    expect(() => assertNoAutoDdlInProduction(undefined, true)).toThrow(/SCHEMA SAFETY/);
  });

  it('6. الحاجز لا يعترض الحالات المشروعة', () => {
    expect(() => assertNoAutoDdlInProduction('production', false)).not.toThrow();
    expect(() => assertNoAutoDdlInProduction('development', true)).not.toThrow();
  });

  it('7. رسالة الحاجز لا تكشف أي سر', () => {
    let msg = '';
    try { assertNoAutoDdlInProduction('production', true); } catch (e: any) { msg = e.message; }
    expect(msg).not.toMatch(/postgres(ql)?:\/\//);
    expect(msg).not.toMatch(/password|DATABASE_URL=|JWT_SECRET|sk-|@[\w.-]+\.(com|co|io)/i);
    expect(msg).toContain('docs/SCHEMA_CHANGE_POLICY.md');
  });
});

/**
 * حارس الإقلاع الحقيقي.
 *
 * يبني البيانات الوصفية لكل الكيانات تماماً كما يفعل NestJS عند بدء التشغيل،
 * لكن **بلا اتصال بقاعدة بيانات**. هذا بالضبط ما فشل في الإنتاج أثناء R3A:
 * DataTypeNotSupportedError يُرمى في buildMetadatas قبل أي اتصال، فيسقط الإقلاع.
 *
 * لا يلتقطه tsc (الأنواع سليمة) ولا nest build ولا اختبارات الوحدة المعتادة.
 */
describe('R3A.1 · بناء البيانات الوصفية للكيانات (محاكاة الإقلاع بلا قاعدة بيانات)', () => {
  const SRC = path.join(__dirname, '..');

  const entityFiles = (function walk(dir: string): string[] {
    const out: string[] = [];
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) out.push(...walk(p));
      else if (e.name.endsWith('.entity.ts')) out.push(p);
    }
    return out;
  })(SRC);

  const entities = entityFiles.flatMap((f) =>
    Object.values(require(f)).filter((v: any) => typeof v === 'function'),
  ) as Function[];

  it('8. عُثر على كل الكيانات', () => {
    expect(entityFiles.length).toBeGreaterThan(15);
    expect(entities.length).toBeGreaterThanOrEqual(entityFiles.length);
  });

  it('9. البيانات الوصفية تُبنى بلا خطأ — الفحص الذي كان سيمنع سقوط الإنتاج', async () => {
    const ds = new DataSource({
      type: 'postgres',
      url: 'postgresql://user:pass@localhost:5432/db',   // لا يُستخدم — لا اتصال يحدث
      entities: entities as any,
      synchronize: false,
    });
    // buildMetadatas لا يفتح اتصالاً؛ يُشغّل نفس التحقق الذي رمى
    // DataTypeNotSupportedError: Data type "Object" in "ImportBatch.source"
    await expect((ds as any).buildMetadatas()).resolves.not.toThrow();
  });

  it('10. أعمدة R3A الثلاثة مبنيّة بأنواع صحيحة', async () => {
    const ds = new DataSource({ type: 'postgres', url: 'postgresql://u:p@h:5432/d', entities: entities as any, synchronize: false });
    await (ds as any).buildMetadatas();
    const { Invoice } = require(path.join(SRC, 'modules', 'invoices', 'invoice.entity'));
    const cols = ds.getMetadata(Invoice).columns;
    const byName = (n: string) => cols.find((c) => c.databaseName === n);
    expect(byName('data_origin')).toBeTruthy();
    expect(byName('settlement_basis')).toBeTruthy();
    expect(byName('import_batch_id')).toBeTruthy();
    expect(byName('data_origin')!.default).toBe('operational');
    expect(byName('settlement_basis')!.default).toBe('none');
  });

  it('11. قيود CHECK والمفتاح الخارجي معرَّفة بالأسماء التي أنشأتها الهجرة', async () => {
    // TypeORM يوفّق بالاسم فقط ويُسقِط ما لا يعرفه — التطابق شرط بقاء الضمانات
    const ds = new DataSource({ type: 'postgres', url: 'postgresql://u:p@h:5432/d', entities: entities as any, synchronize: false });
    await (ds as any).buildMetadatas();
    const { Invoice } = require(path.join(SRC, 'modules', 'invoices', 'invoice.entity'));
    const meta = ds.getMetadata(Invoice);
    const checkNames = meta.checks.map((c: any) => c.name).sort();
    expect(checkNames).toEqual(['chk_inv_data_origin', 'chk_inv_presystem_requires_batch', 'chk_inv_settlement_basis']);
    const fk = meta.foreignKeys.find((f: any) => f.columnNames.includes('import_batch_id'));
    expect(fk).toBeTruthy();
    expect(fk!.name).toBe('fk_invoices_import_batch');
  });

  it('12. كل كيان له اسم جدول صريح', async () => {
    const ds = new DataSource({ type: 'postgres', url: 'postgresql://u:p@h:5432/d', entities: entities as any, synchronize: false });
    await (ds as any).buildMetadatas();
    for (const m of ds.entityMetadatas) expect(m.tableName).toBeTruthy();
  });
});
