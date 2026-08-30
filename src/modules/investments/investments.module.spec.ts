import 'reflect-metadata';
import { Global, Module } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Test } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { InvestmentsModule } from './investments.module';
import { InvestmentsController } from './investments.controller';
import { JwtAuthGuard } from '../../common/jwt-auth.guard';
import { ScreenGuard } from '../../common/screen.guard';

/**
 * ── اختبار تركيب الوحدة ──
 *
 * على نمط `receipts.module.spec.ts`، وللسبب نفسه: خطأُ حقن التبعيات لا يظهر في
 * `tsc` ولا في البناء ولا في اختبار دالّةٍ خالصة — يظهر عند الإقلاع فتسقط
 * الخدمة كلُّها. وقد سقط الإنتاج بذلك فعلاً.
 *
 * وهذه الوحدة تحمل ثمانية مستودعات، فرسمُها أوسع من غيرها.
 */
@Global()
@Module({
  providers: [{
    provide: getDataSourceToken(),
    useValue: {
      entityMetadatas: [],
      options: { type: 'postgres' },
      getRepository: () => ({}),
    } as unknown as DataSource,
  }],
  exports: [getDataSourceToken()],
})
class StubDataSourceModule {}

describe('تركيب InvestmentsModule', () => {
  it('يُركَّب رسم التبعيات كاملاً بمستوداعاته الثمانية', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [StubDataSourceModule, InvestmentsModule],
    }).compile();

    expect(moduleRef.get(InvestmentsController, { strict: false })).toBeDefined();
    await moduleRef.close();
  });

  it('الموجّه على `api/investments/stone`', () => {
    expect(Reflect.getMetadata('path', InvestmentsController)).toBe('api/investments/stone');
  });

  /*
   * ── الحدّ دورٌ لا منحة ──
   *
   * `JwtAuthGuard` وحده على الصنف، و`ensureAdmin` في كلّ موجّه. ولا
   * `ScreenGuard`: هو يقرأ `allowed_screens` وهي قوائمُ تُمنح وتُسحب — وكارتٌ
   * يحمل قرضاً بين شركةٍ أمٍّ وتابعتها لا يُترك لقائمةٍ تُنسى فتُمنح سهواً.
   */
  it('محروسٌ بالمصادقة، وبلا `ScreenGuard`', () => {
    const guards = (Reflect.getMetadata(GUARDS_METADATA, InvestmentsController) || []) as any[];
    expect(guards).toContain(JwtAuthGuard);
    expect(guards).not.toContain(ScreenGuard);
  });

  /*
   * كلُّ موجّهٍ يفحص الدور بنفسه.
   *
   * فحارسٌ على الصنف وحده يكفي للمصادقة، لكنّ الدور يُفحص في كلّ دالّة —
   * ونسيانُ واحدةٍ يفتح الكارت لكلّ من يملك رمزاً. فيُعدّ عدداً.
   */
  it('لا موجّهَ بلا فحص دور', () => {
    const proto = InvestmentsController.prototype as any;
    const methods = Object.getOwnPropertyNames(proto).filter((m) => m !== 'constructor');
    expect(methods.length).toBeGreaterThanOrEqual(11);
    const src = InvestmentsController.toString();
    const calls = (src.match(/ensureAdmin/g) || []).length;
    expect(calls).toBeGreaterThanOrEqual(methods.length);
  });
});
