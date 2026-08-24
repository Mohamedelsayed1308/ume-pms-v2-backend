import { Global, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { BrokersModule } from './brokers.module';
import { BrokersService } from './brokers.service';
import { BrokersController } from './brokers.controller';
import { HireInvoicesModule } from '../hire-invoices/hire-invoices.module';
import { HireInvoicesController } from '../hire-invoices/hire-invoices.controller';
import { ScreenGuard } from '../../common/screen.guard';

/**
 * ── اختبار تركيب الوحدتين معاً ──
 *
 * وحدةُ فواتير الإيجار تستورد وحدةَ البروكر لتُزامن الاستحقاقات. والاستيراد
 * المتبادل — لو وقع — يُسقط الإقلاع بـ `undefined dependency`، **ولا يكشفه
 * `tsc` ولا البناء ولا اختبارات الدوالّ الخالصة**.
 *
 * فتُركَّب الوحدتان هنا معاً، ويُطلب متحكّم الفواتير صراحةً: هو الذي يحقن
 * `BrokersService`، وهو أوّل ما ينكسر إن اختلّ الرسم.
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

describe('تركيب BrokersModule مع فواتير الإيجار', () => {
  it('يُركَّب الرسم كاملاً — ومتحكّم الفواتير يجد خدمة البروكر', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [StubDataSourceModule, BrokersModule, HireInvoicesModule],
    }).compile();

    expect(moduleRef.get(BrokersService, { strict: false })).toBeDefined();
    expect(moduleRef.get(BrokersController, { strict: false })).toBeDefined();
    // هذا هو موضع الخطر: متحكّمٌ في وحدةٍ يحقن خدمةً من وحدةٍ أخرى
    expect(moduleRef.get(HireInvoicesController, { strict: false })).toBeDefined();
    expect(moduleRef.get(ScreenGuard, { strict: false })).toBeDefined();

    await moduleRef.close();
  });
});
