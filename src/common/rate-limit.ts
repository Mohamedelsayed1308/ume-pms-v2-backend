import type { ThrottlerOptions } from '@nestjs/throttler';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * تحديد معدّل تسجيل الدخول
 *
 * `POST /api/auth/login` كان مفتوحاً بلا حدّ محاولات — تخمينٌ آليٌّ بلا مقاومة
 * على نظامٍ يحمل دفاتر شركةٍ كاملة.
 *
 * والسياسة محافظة عمداً: خمس محاولات في الدقيقة لكلّ عنوان. المستخدم الذي
 * يُخطئ كلمته مرّةً أو مرّتين لا يشعر بشيء، والذي يجرّب مئةً في الدقيقة يُوقَف.
 * ═══════════════════════════════════════════════════════════════════════════
 */

export const LOGIN_THROTTLER = 'login';
export const LOGIN_LIMIT = 5;
export const LOGIN_TTL_MS = 60_000;
export const LOGIN_BLOCK_MS = 60_000;

/**
 * عنوان العميل الحقيقي — لا عنوان البروكسي.
 *
 * `req.ip` خلف حافّة Railway يُرجع عنوان البروكسي نفسه لكلّ الطلبات، فيقع
 * المستخدمون جميعاً في دلوٍ واحد: خمس محاولاتٍ من أيٍّ كان تُوقف الشركة كلَّها
 * دقيقة. حدٌّ يمنع الهجوم ويمنع أصحاب البيت معه لا يصلح.
 *
 * فيُقرأ `x-forwarded-for`، **وتُؤخذ آخر قيمةٍ فيه لا أولاها**: العميل يستطيع
 * إرسال الترويسة بنفسه فتُصدَّر قائمتَه، وتُلحق الحافّةُ عنوانَه الحقيقي في
 * آخرها. فالأول مزوَّرٌ محتمل، والأخير هو ما رآه الوسيط الموثوق.
 *
 * وإن غابت الترويسة — تشغيلٌ محلّي أو بلا بروكسي — رجع إلى `req.ip`.
 */
export function clientIp(req: Record<string, any>): string {
  const raw = req?.headers?.['x-forwarded-for'];
  const chain = Array.isArray(raw) ? raw.join(',') : typeof raw === 'string' ? raw : '';
  const hops = chain.split(',').map((s) => s.trim()).filter(Boolean);
  if (hops.length) return hops[hops.length - 1];
  return req?.ip || req?.socket?.remoteAddress || 'unknown';
}

/**
 * إعداد المُحدِّد المُسجَّل على مستوى التطبيق.
 *
 * ولا يُطبَّق على شيءٍ من تلقاء نفسه: `ThrottlerGuard` يُوضع على موجّه تسجيل
 * الدخول وحده. فبقيّة النظام تبقى بلا حدٍّ في هذه المرحلة.
 *
 * ⚠ التخزين في ذاكرة العملية. فمع أكثر من نسخةٍ على Railway يصير الحدّ لكلّ
 *   نسخةٍ على حدة — يُضعف الحدّ ولا يُبطله. وتوحيدُه يحتاج مخزناً مشتركاً.
 */
export const LOGIN_THROTTLE: ThrottlerOptions = {
  name: LOGIN_THROTTLER,
  ttl: LOGIN_TTL_MS,
  limit: LOGIN_LIMIT,
  blockDuration: LOGIN_BLOCK_MS,
  getTracker: (req) => clientIp(req),
};
