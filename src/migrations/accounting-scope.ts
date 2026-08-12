/**
 * ── نطاق الدفتر المحاسبي ──
 *
 * الدفتر لـSivamar وحدها، ومركبها Gubal Trader. وبقية المراكب لشركات أخرى لا
 * يخصّها هذا الدفتر — فبلا ربط صريح تعرض الشاشات كل شيء، ويصير ترحيل فاتورة
 * مركب لا يخصّ الكيان خطأً ممكناً لا يمنعه شيء.
 *
 * الربط على مستوى **الشركة المالكة** لا المركب: المركب يتبع شركة، والشركة تتبع
 * كياناً محاسبياً. فإضافة مركب جديد لشركة مربوطة تدخله النطاق تلقائياً بلا إعداد.
 *
 * والعمود يقبل العدم عمداً: الشركة غير المربوطة **خارج النطاق** — لا تُفترض
 * داخله. الصمت هنا يعني الاستبعاد لا الشمول.
 */

export const ACCOUNTING_SCOPE_UP: string[] = [
  `ALTER TABLE shipping_companies ADD COLUMN IF NOT EXISTS legal_entity_id UUID`,

  `ALTER TABLE shipping_companies DROP CONSTRAINT IF EXISTS fk_sc_legal_entity`,
  `ALTER TABLE shipping_companies ADD CONSTRAINT fk_sc_legal_entity
     FOREIGN KEY (legal_entity_id) REFERENCES legal_entities(id) ON DELETE RESTRICT`,

  `CREATE INDEX IF NOT EXISTS ix_sc_legal_entity ON shipping_companies (legal_entity_id)`,
];

export const ACCOUNTING_SCOPE_DOWN: string[] = [
  `ALTER TABLE shipping_companies DROP CONSTRAINT IF EXISTS fk_sc_legal_entity`,
  `DROP INDEX IF EXISTS ix_sc_legal_entity`,
  `ALTER TABLE shipping_companies DROP COLUMN IF EXISTS legal_entity_id`,
];

export function renderSql(statements: string[], label: string): string {
  return `-- ${label}\nBEGIN;\n\n` +
    statements.map((s) => s.trim().replace(/;\s*$/, '') + ';').join('\n\n') +
    `\n\nCOMMIT;\n`;
}
