/**
 * سياسة تعديل المخطط.
 *
 * وُضعت بعد حادثة إنتاج حقيقية في R3A: أُرجع الكود إلى نسخة لا تعرف أعمدة R3A،
 * فأسقط `synchronize: true` تلك الأعمدة من قاعدة البيانات ومعها توسيم 128 فاتورة —
 * صامتاً، بلا خطأ ولا تحذير. لم يكن ذلك خللاً في TypeORM بل سلوكه المعلن:
 * الكيان هو الحقيقة، وما لا يعرفه يُحذف.
 *
 * الخلاصة: إرجاع الكود — وهو أسلم إجراء عند عطل — صار عملية مدمِّرة للبيانات.
 * لذلك يُمنع تعديل المخطط تلقائياً في الإنتاج منعاً باتاً.
 */

/**
 * الإنتاج هو الافتراض ما لم تُعلَن البيئة صراحةً غير ذلك (fail-closed).
 * متغيّر غير مضبوط ⇒ إنتاج ⇒ لا DDL تلقائي. لا نعتمد على أي fallback غامض.
 */
export function isProduction(nodeEnv: string | undefined): boolean {
  const env = (nodeEnv || '').trim().toLowerCase();
  return !(env === 'development' || env === 'test' || env === 'dev');
}

/** الإنتاج: false دائماً. غيره: مسموح للتطوير المحلي. */
export function shouldSynchronize(nodeEnv: string | undefined): boolean {
  return !isProduction(nodeEnv);
}

/**
 * حاجز أمان: يُوقف الإقلاع لو تسرّب synchronize=true إلى الإنتاج بأي طريق
 * (تحرير خاطئ · دمج · إعداد بيئة). التوقّف الفوري أرخص بكثير من فقدان بيانات صامت.
 */
export function assertNoAutoDdlInProduction(nodeEnv: string | undefined, synchronize: boolean): void {
  if (isProduction(nodeEnv) && synchronize) {
    throw new Error(
      'SCHEMA SAFETY: automatic schema synchronization is enabled in production. ' +
      'This is refused: TypeORM drops any column, constraint or index it does not find in entity ' +
      'metadata, which already destroyed migrated data once. Production schema changes go through ' +
      'an explicit reviewed migration only. See docs/SCHEMA_CHANGE_POLICY.md',
    );
  }
}
