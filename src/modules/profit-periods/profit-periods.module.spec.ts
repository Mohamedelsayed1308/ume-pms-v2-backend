import { Global, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { ProfitPeriodsModule } from './profit-periods.module';
import { ProfitPeriodsController } from './profit-periods.controller';
import { ProfitRatificationService } from './profit-ratification.service';
import { ScreenGuard } from '../../common/screen.guard';

/**
 * ── اختبار تركيب الوحدة ──
 *
 * أُضيف مع خدمة المصادقة ومستودع دفتر الفروق. وحقن التبعيات **لا يُكتشف**
 * بـ `tsc` ولا بالبناء ولا باختبارات الدوالّ الخالصة: مستودعٌ لم يُسجَّل في
 * `forFeature` يمرّ في الترجمة كلّها ثمّ يُسقط الخدمة عند الإقلاع.
 *
 * فيُركَّب الرسم هنا كاملاً، ويُطلب صراحةً كلٌّ من: المتحكّم، وخدمة المصادقة
 * (وهي التي تحقن مستودعين لا واحداً)، والحارس.
 *
 * وتُحاكى `TypeOrmModule.forRoot` بوحدةٍ عامّة كما في `receipts.module.spec`.
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

describe('تركيب ProfitPeriodsModule', () => {
  it('يُركَّب رسم التبعيات كاملاً — ومستودعا الفترة ودفتر الفروق يُحقنان', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [StubDataSourceModule, ProfitPeriodsModule],
    }).compile();

    expect(moduleRef.get(ProfitPeriodsController, { strict: false })).toBeDefined();
    // خدمة المصادقة تحقن مستودعين — وهي أوّل ما ينكسر إن نُسي `forFeature`
    expect(moduleRef.get(ProfitRatificationService, { strict: false })).toBeDefined();
    expect(moduleRef.get(ScreenGuard, { strict: false })).toBeDefined();

    await moduleRef.close();
  });
});
