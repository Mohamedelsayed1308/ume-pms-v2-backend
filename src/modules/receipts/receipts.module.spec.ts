import { Global, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { ReceiptsModule } from './receipts.module';
import { ReceiptsController } from './receipts.controller';
import { ScreenGuard } from '../../common/screen.guard';

/**
 * ── اختبار تركيب الوحدة ──
 *
 * كُتب بعد انهيار إنتاجي: `ReceiptsModule` لم تستورد `CommonAuthzModule`، فعجز
 * Nest عن حقن `ScreenAuthzService` في `ScreenGuard` **عند الإقلاع** وسقطت الخدمة.
 *
 * لم يمسك ذلك `tsc` ولا البناء ولا اختبارات الدوالّ الخالصة: حقن التبعيات لا
 * يُكتشف إلا بتركيب الرسم البياني فعلاً. فهذا الاختبار يُركّبه.
 *
 * `TypeOrmModule.forRoot` عامّة في التطبيق الحقيقي وتوفّر `DataSource` للجميع،
 * فتُحاكى هنا بوحدة عامّة مكافئة — وتبقى وارداتُ الوحدة نفسها هي محلّ الاختبار.
 */
@Global()
@Module({
  providers: [{
    provide: getDataSourceToken(),
    // ما يقرؤه مصنع مستودعات TypeORM فعلاً: البيانات الوصفية ثم نوع المحرّك.
    useValue: {
      entityMetadatas: [],
      options: { type: 'postgres' },
      getRepository: () => ({}),
    } as unknown as DataSource,
  }],
  exports: [getDataSourceToken()],
})
class StubDataSourceModule {}

describe('تركيب ReceiptsModule', () => {
  it('يُركَّب رسم التبعيات كاملاً — والحارس يجد خدمته', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [StubDataSourceModule, ReceiptsModule],
    }).compile();

    // الحارس هو ما انهار عليه الإنتاج — فيُطلب صراحةً من سياق الوحدة.
    expect(moduleRef.get(ReceiptsController, { strict: false })).toBeDefined();
    expect(moduleRef.get(ScreenGuard, { strict: false })).toBeDefined();

    await moduleRef.close();
  });
});
