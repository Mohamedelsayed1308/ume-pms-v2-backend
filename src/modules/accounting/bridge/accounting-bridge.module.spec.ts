import { Global, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AccountingModule } from '../accounting.module';
import { AccountingBridgeController } from './accounting-bridge.controller';
import { AccountingBridgeService } from './accounting-bridge.service';
import { ScreenGuard } from '../../../common/screen.guard';

// الدرس الذي دفعنا ثمنه: وحدة Nest جديدة لا تُدفع قبل أن يُركَّب رسم تبعياتها.
@Global()
@Module({
  providers: [{ provide: getDataSourceToken(), useValue: {
    entityMetadatas: [], options: { type: 'postgres' }, getRepository: () => ({}),
  } as unknown as DataSource }],
  exports: [getDataSourceToken()],
})
class StubDataSourceModule {}

describe('تركيب جسر المحاسبة', () => {
  it('يُركَّب رسم التبعيات — والحارس والخدمة يجدان ما يحتاجانه', async () => {
    const m = await Test.createTestingModule({ imports: [StubDataSourceModule, AccountingModule] }).compile();
    expect(m.get(AccountingBridgeController, { strict: false })).toBeDefined();
    expect(m.get(AccountingBridgeService, { strict: false })).toBeDefined();
    expect(m.get(ScreenGuard, { strict: false })).toBeDefined();
    await m.close();
  });
});
