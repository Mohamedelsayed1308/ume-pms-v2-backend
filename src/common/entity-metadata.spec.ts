import * as fs from 'fs';
import * as path from 'path';

/**
 * حارس إقلاع.
 *
 * العمود المُعلَن بنوع اتحادي (`string | null`) بلا `type:` صريح يُصدِر
 * design:type = Object، فيرفضه TypeORM بـDataTypeNotSupportedError **عند بناء
 * البيانات الوصفية** — أي قبل أن يتصل بالقاعدة أصلاً، فتسقط الخدمة كلها.
 *
 * لا يلتقطه المُصرِّف (الأنواع سليمة) ولا اختبارات الوحدة (لا تُقلع DataSource).
 * سقط الإنتاج بهذا الخطأ فعلياً في R3A، فصار له اختبار.
 */
describe('كيانات · النوع الصريح إلزامي مع الأنواع الاتحادية', () => {
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

  it('يوجد كيانات لفحصها', () => expect(entityFiles.length).toBeGreaterThan(10));

  it('كل @Column على خاصية بنوع اتحادي يعلن type صراحةً', () => {
    const offenders: string[] = [];

    for (const file of entityFiles) {
      const text = fs.readFileSync(file, 'utf8');
      // @Column(...) ثم اسم الخاصية ونوعها — على سطر واحد أو سطرين
      const re = /@Column\(([^)]*)\)\s*(?:\r?\n\s*)?([A-Za-z_][\w]*)\s*:\s*([^;]+);/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(text))) {
        const [, opts, prop, tsType] = m;
        const isUnion = tsType.includes('|');
        const hasExplicitType = /(^|[{,\s])type\s*:/.test(opts);
        if (isUnion && !hasExplicitType) {
          offenders.push(`${path.relative(SRC, file)} :: ${prop}: ${tsType.trim()}`);
        }
      }
    }

    // الرسالة تسمّي المخالف بالضبط — لا بحث يدوي عند الفشل
    expect(offenders).toEqual([]);
  });

  it('كيان ImportBatch تحديداً سليم (السجل الذي أسقط الإنتاج)', () => {
    const p = path.join(SRC, 'modules', 'invoices', 'import-batch.entity.ts');
    const text = fs.readFileSync(p, 'utf8');
    for (const col of ['source', 'approved_by_name', 'approval_reference']) {
      const re = new RegExp(`@Column\\(([^)]*)\\)\\s*(?:\\r?\\n\\s*)?${col}\\s*:`);
      const m = text.match(re);
      expect(m).toBeTruthy();
      expect(m![1]).toContain("type: 'varchar'");
    }
  });
});
