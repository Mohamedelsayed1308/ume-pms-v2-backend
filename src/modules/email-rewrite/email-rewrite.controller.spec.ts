import 'reflect-metadata';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { ThrottlerGuard } from '@nestjs/throttler';
import { JwtAuthGuard } from '../../common/jwt-auth.guard';
import { ScreenGuard } from '../../common/screen.guard';
import { EmailRewriteController } from './email-rewrite.controller';

/**
 * ── حرّاس الموجّه ──
 *
 * الدعوى المُختبَرة هنا **سلبيّة قبل أن تكون إيجابيّة**: أنّ `ScreenGuard`
 * ليس على هذا الموجّه.
 *
 * فالشاشة `always: true` — متاحةٌ لكلّ مستخدم — و`ScreenGuard` يقرأ
 * `allowed_screens`، وغيرُ الأدمن ليس له فيها سطرٌ لشاشةٍ جديدة. فلو وُضع
 * الحارس لمنع كلَّ من ليس أدمن، ولبدا العطب صلاحيّةً ناقصةً لا خطأً في الكود
 * — ولطُلب من الأدمن أن «يمنح» شاشةً هي ممنوحةٌ أصلاً.
 *
 * والحرّاس على الصنف لا على الدالّة: `@UseGuards` فوق `@Controller` يسري على
 * كلّ موجّهاته. فالقراءة من `prototype.rewrite` ترجع فارغاً وتُخطئ الحكم.
 */
describe('حرّاس Email Rewrite', () => {
  const classGuards = (Reflect.getMetadata(GUARDS_METADATA, EmailRewriteController) || []) as any[];
  const methodGuards = (Reflect.getMetadata(GUARDS_METADATA, EmailRewriteController.prototype.rewrite) || []) as any[];
  const guards = [...classGuards, ...methodGuards];

  it('المصادقة مطلوبة', () => {
    expect(guards).toContain(JwtAuthGuard);
  });

  it('حدُّ الاستخدام مطبَّق', () => {
    expect(guards).toContain(ThrottlerGuard);
  });

  it('المصادقة تسبق الحدَّ — فمفتاح الحدّ هو المستخدم لا العنوان', () => {
    /*
     * الترتيب معلومةٌ لا تنسيق. `userTracker` يقرأ `req.user.id`، ولا يضعه
     * هناك إلا `JwtAuthGuard`. فلو تقدّم `ThrottlerGuard` لوجد الطلب بلا
     * هويّة، فارتدّ إلى العنوان — ولوقع مكتبٌ كاملٌ خلف بوّابةٍ واحدة في دلوٍ
     * واحد، فأوقف أوّلُ من يستعملها بقيّةَ الشركة.
     */
    expect(classGuards.indexOf(JwtAuthGuard)).toBeLessThan(classGuards.indexOf(ThrottlerGuard));
  });

  it('لا `ScreenGuard` — فغير الأدمن يستعملها بلا منحٍ في `allowed_screens`', () => {
    expect(guards).not.toContain(ScreenGuard);
  });
});
