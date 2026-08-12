/**
 * ── إسقاط اشتراط الشخصين في اعتماد سعر الصرف ──
 *
 * القرار تشغيلي: مُدخِل البيانات واحد، فاشتراط معتمِد ثانٍ يوقف العمل لا ينظّمه.
 *
 * **ما يسقط:** `created_by <> approved_by`.
 * **ما يبقى:** الاعتماد نفسه — فعلٌ منفصل لاحق للإنشاء، مسجَّل بفاعله ووقته،
 * وشرطٌ للترحيل لكل مصدر بلا استثناء. فالسعر لا يدخل الدفتر لأنه أُدخِل، بل لأن
 * أحداً راجعه وختمه.
 *
 * ويبقى كذلك `chk_fx_approval_pairing` — معتمِدٌ بلا وقت اعتمادٌ ناقص.
 */

export const FX_SELFAPPROVAL_UP: string[] = [
  `ALTER TABLE accounting_fx_rates DROP CONSTRAINT IF EXISTS chk_fx_no_self_approval`,
];

export const FX_SELFAPPROVAL_DOWN: string[] = [
  // الإعادة مشروطة: صفوف اعتمدها منشئوها بعد الإسقاط تمنع القيد، فيتوقّف
  // التراجع برسالة تقول ما المانع بدل أن يفشل غامضاً أو يمحو بيانات.
  `DO $back$
   DECLARE selfapproved int;
   BEGIN
     SELECT COUNT(*) INTO selfapproved
       FROM accounting_fx_rates
      WHERE approved_by IS NOT NULL AND created_by IS NOT NULL AND approved_by = created_by;

     IF selfapproved > 0 THEN
       RAISE EXCEPTION 'التراجع متوقّف: % سعر صرف اعتمده منشئه. أعد اعتمادها بمستخدم آخر أو احذفها قبل إعادة اشتراط الشخصين.', selfapproved;
     END IF;

     ALTER TABLE accounting_fx_rates ADD CONSTRAINT chk_fx_no_self_approval CHECK (
       approved_by IS NULL OR created_by IS NULL OR approved_by <> created_by);
   END $back$`,
];

export function renderSql(statements: string[], label: string): string {
  return `-- ═══ ${label} ═══\nBEGIN;\n\n` +
    statements.map((s) => s.trim().replace(/;\s*$/, '') + ';').join('\n\n') +
    `\n\nCOMMIT;\n`;
}
