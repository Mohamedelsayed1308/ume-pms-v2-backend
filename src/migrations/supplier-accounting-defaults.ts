/**
 * ── افتراضيات المورّد المحاسبية ──
 *
 * جدول مستقل لا أعمدة على `suppliers`: التصنيف المحاسبي شأن المحاسبة، وإقحامه
 * في جدول أعمال أساسي يخلط ملكيّتين ويجعل كل تغيير محاسبي لاحق يمسّ جدولاً
 * تعتمد عليه ثمانية عشر شاشة.
 *
 * والافتراضي **اقتراح لا قرار**: الجسر يقرؤه ليملأ الحقل، ويبقى للمُعِدّ تغييره
 * في القيد نفسه. فمن يوقّع على التصنيف هو من رحّل، لا صفٌّ في جدول إعدادات.
 */

export const SUPPLIER_DEFAULTS_UP: string[] = [
  `CREATE TABLE IF NOT EXISTS supplier_accounting_defaults (
     id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     legal_entity_id   UUID NOT NULL,
     supplier_id       UUID NOT NULL,
     debit_account_id  UUID NOT NULL,
     accrual_category  VARCHAR(20) NOT NULL,
     notes             VARCHAR(300),
     created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
     updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
     updated_by        UUID
   )`,

  `ALTER TABLE supplier_accounting_defaults DROP CONSTRAINT IF EXISTS chk_sad_category`,
  `ALTER TABLE supplier_accounting_defaults ADD CONSTRAINT chk_sad_category CHECK (
     accrual_category IN ('GOODS', 'PERIOD_SERVICE'))`,

  `ALTER TABLE supplier_accounting_defaults DROP CONSTRAINT IF EXISTS fk_sad_supplier`,
  `ALTER TABLE supplier_accounting_defaults ADD CONSTRAINT fk_sad_supplier
     FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE CASCADE`,

  `ALTER TABLE supplier_accounting_defaults DROP CONSTRAINT IF EXISTS fk_sad_account`,
  `ALTER TABLE supplier_accounting_defaults ADD CONSTRAINT fk_sad_account
     FOREIGN KEY (debit_account_id) REFERENCES accounting_accounts(id) ON DELETE RESTRICT`,

  `ALTER TABLE supplier_accounting_defaults DROP CONSTRAINT IF EXISTS fk_sad_entity`,
  `ALTER TABLE supplier_accounting_defaults ADD CONSTRAINT fk_sad_entity
     FOREIGN KEY (legal_entity_id) REFERENCES legal_entities(id) ON DELETE RESTRICT`,

  // افتراضي واحد لكل مورّد في كل كيان — وإلا صار «الافتراضي» سؤالاً جديداً.
  `CREATE UNIQUE INDEX IF NOT EXISTS uq_sad_entity_supplier
     ON supplier_accounting_defaults (legal_entity_id, supplier_id)`,

  `ALTER TABLE supplier_accounting_defaults ENABLE ROW LEVEL SECURITY`,
  `DO $rev$
   DECLARE r text;
   BEGIN
     FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
       IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
         EXECUTE format('REVOKE ALL ON supplier_accounting_defaults FROM %I', r);
       END IF;
     END LOOP;
   END $rev$`,
];

export const SUPPLIER_DEFAULTS_DOWN: string[] = [
  `DROP TABLE IF EXISTS supplier_accounting_defaults`,
];

export function renderSql(statements: string[], label: string): string {
  return `-- ${label}\nBEGIN;\n\n` +
    statements.map((s) => s.trim().replace(/;\s*$/, '') + ';').join('\n\n') +
    `\n\nCOMMIT;\n`;
}
