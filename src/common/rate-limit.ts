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
 * عدد الوسطاء الموثوقين أمام التطبيق.
 *
 * صفرٌ = **غير معلوم**، وهو الافتراضي عمداً.
 *
 * فحصتُ حافّة Railway بطلبٍ حقيقي فردّت:
 *   `x-railway-edge: zrh1` · `x-hikari-trace: zrh1.1vv1` · `server: railway-hikari`
 * ومعرّفان في أثرٍ واحد يُرجّحان حافّةً ثمّ موجّهاً داخلياً — **ولا يُثبتان عدد
 * ما يُكتب في `x-forwarded-for`**. ولا سبيل لرؤية الترويسة كما يستلمها التطبيق
 * من خارجه.
 *
 * فمتى أثبتَّ العدد — بسطرٍ يطبع الترويسة مرّةً ثم يُزال — اضبط المتغيّر،
 * فيصير المفتاح مقاوماً للتزوير.
 */
export const TRUST_PROXY_HOPS = Number(process.env.TRUST_PROXY_HOPS) || 0;

export interface ProxyAwareRequest {
  headers?: Record<string, string | string[] | undefined>;
  ip?: string;
  socket?: { remoteAddress?: string };
}

/**
 * مفتاح تمييز العميل — لا عنوان البروكسي.
 *
 * `req.ip` خلف الحافّة يُرجع عنوان البروكسي نفسه لكلّ الطلبات، فيقع المستخدمون
 * جميعاً في دلوٍ واحد: خمس محاولاتٍ من أيٍّ كان تُوقف الشركة كلَّها دقيقة.
 *
 * ── ولماذا السلسلة كلُّها حين يُجهل العدد ──
 * أخذُ **آخر** قفزةٍ يصحّ لو كان الوسيط واحداً؛ فإن كانا اثنين رجع عنوان الموجّه
 * الداخلي — وعاد الانهيار الذي جئنا نمنعه. وأخذُ **أوّلها** يقبل التزوير.
 *
 * والخطران غير متكافئين: الانهيار يوقف الشركة، والتزوير يُعيدنا إلى ما نحن عليه
 * اليوم لا أسوأ. فحين يُجهل العدد تُستعمل السلسلة كلُّها مفتاحاً: عنوان العميل
 * فيها أياً كان عدد القفزات، فلا يلتقي عميلان في دلوٍ أبداً — ويبقى التزوير
 * ممكناً، معلوماً، مكتوباً.
 *
 * ومتى ضُبط `TRUST_PROXY_HOPS` أُخذ الموضع الدقيق فسقط التزوير.
 *
 * وإن غابت الترويسة — تشغيلٌ محلّي أو بلا بروكسي — رجع إلى `req.ip`.
 */
export function clientIp(
  req: ProxyAwareRequest,
  trustedHops: number = TRUST_PROXY_HOPS,
): string {
  const raw = req?.headers?.['x-forwarded-for'];
  const joined = Array.isArray(raw) ? raw.join(',') : (raw ?? '');
  const chain = joined
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  if (!chain.length) return req?.ip || req?.socket?.remoteAddress || 'unknown';

  // عددٌ معلومٌ وسلسلةٌ تكفيه ⇒ الموضع الدقيق، مقاومٌ للتزوير
  if (trustedHops > 0 && chain.length >= trustedHops) {
    return chain[chain.length - trustedHops];
  }

  // مجهولٌ أو سلسلةٌ أقصر من المتوقَّع ⇒ السلسلة كلُّها: لا انهيار، والتزوير معلوم
  return chain.join('|');
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

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * تحديد معدّل إعادة صياغة الإيميلات
 *
 * `POST /api/email/rewrite` ينادي نموذجاً خارجيّاً بالمال في كلّ طلب — وزرُّ
 * «أعد الصياغة» وأزرارُ الصقل الثلاثة تحته تجعل النقر رخيصاً والنداء غالياً.
 * فحلقةٌ عابثة، أو إصبعٌ عالق، تُنفق ما لا يُسترجع.
 *
 * وعشرون في الساعة سخيّةٌ لمن يكتب فعلاً: إيميلٌ ثمّ صقلتان يُنفقان ثلاثة.
 *
 * ── والمفتاح هنا المستخدم لا العنوان ──
 * لأنّ الموجّه محروسٌ بـ `JwtAuthGuard`، فالهويّة معلومةٌ ومُثبَتةٌ برمزٍ موقَّع
 * — وهي أدقّ من عنوانٍ يشترك فيه مكتبٌ كامل خلف بوّابةٍ واحدة. ولولا ذلك
 * لأوقف أوّلُ من يستعملها بقيّةَ الشركة.
 *
 * ويبقى `clientIp` احتياطاً لطلبٍ بلا هويّة — وهو ما لا يمرّ الحارسَ أصلاً.
 * ═══════════════════════════════════════════════════════════════════════════
 */

export const EMAIL_REWRITE_THROTTLER = 'email-rewrite';
export const EMAIL_REWRITE_LIMIT = 20;
export const EMAIL_REWRITE_TTL_MS = 3_600_000;

export interface AuthedRequest extends ProxyAwareRequest {
  user?: { id?: string };
}

/** هويّة المستخدم إن وُجدت، وإلا مفتاح العنوان المراعي للبروكسي. */
export function userTracker(req: AuthedRequest): string {
  const id = req?.user?.id;
  return id ? `u:${id}` : clientIp(req);
}

export const EMAIL_REWRITE_THROTTLE: ThrottlerOptions = {
  name: EMAIL_REWRITE_THROTTLER,
  ttl: EMAIL_REWRITE_TTL_MS,
  limit: EMAIL_REWRITE_LIMIT,
  getTracker: (req) => userTracker(req as AuthedRequest),
};
