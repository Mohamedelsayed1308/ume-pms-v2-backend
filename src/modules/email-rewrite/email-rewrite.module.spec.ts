import { Test } from '@nestjs/testing';
import { ThrottlerModule } from '@nestjs/throttler';
import { EMAIL_REWRITE_THROTTLE } from '../../common/rate-limit';
import { EmailRewriteModule } from './email-rewrite.module';
import { EmailRewriteController } from './email-rewrite.controller';

/**
 * ── اختبار تركيب الوحدة ──
 *
 * على نمط `receipts.module.spec.ts`، وللسبب نفسه: حقنُ التبعيات لا يُكتشف
 * خطؤه إلا بتركيب الرسم البياني فعلاً — لا `tsc` يراه ولا البناء ولا اختبار
 * دالّةٍ خالصة. وقد أسقط ذلك الإنتاجَ مرّةً من قبل.
 *
 * وهذه الوحدة تحديداً تدّعي دعوى تُختبر: **أنّها بلا مخزَن**. فلا
 * `StubDataSourceModule` هنا ولا `DataSource` — ولو تسلّل يوماً
 * `TypeOrmModule.forFeature` إليها لعجز Nest عن إيجاد `DataSource` وسقط هذا
 * الاختبار. فغيابُ المُحاكاة هو الحارس.
 *
 * أمّا `ThrottlerModule` فيُستورد هنا لأنّه `@Global()` في التطبيق الحقيقي:
 * `forRoot` في `app.module.ts` يُتيح `THROTTLER:MODULE_OPTIONS` للجميع، فلا
 * تستورده الوحدة — كما لا تستورده `AuthModule` لموجّه تسجيل الدخول. والاختبار
 * يُركّب الوحدة معزولةً فيلزمه أن يوفّر ما يوفّره الجذر.
 */
describe('تركيب EmailRewriteModule', () => {
  it('يُركَّب بلا مصدر بيانات — والكنترولر مُسجَّل', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ThrottlerModule.forRoot([EMAIL_REWRITE_THROTTLE]), EmailRewriteModule],
    }).compile();

    expect(moduleRef.get(EmailRewriteController, { strict: false })).toBeDefined();

    await moduleRef.close();
  });

  it('الموجّه معرَّفٌ على `api/email/rewrite`', () => {
    const prefix = Reflect.getMetadata('path', EmailRewriteController);
    const method = Reflect.getMetadata('path', EmailRewriteController.prototype.rewrite);
    expect(prefix).toBe('api/email');
    expect(method).toBe('rewrite');
  });
});
