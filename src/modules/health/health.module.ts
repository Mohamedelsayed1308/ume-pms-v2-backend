import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';

/**
 * وحدةٌ بلا خدمةٍ ولا مستودع: موجّهٌ واحدٌ يقرأ `DataSource` العامّ.
 * ولا حارسَ عليها عمداً — انظر رأس `health.controller.ts`.
 */
@Module({
  controllers: [HealthController],
})
export class HealthModule {}
