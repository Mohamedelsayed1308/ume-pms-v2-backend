import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CommonAuthzModule } from '../../common/common-authz.module';
import { Broker, BrokerRule, BrokerLedger } from './broker.entity';
import { HireInvoice } from '../hire-invoices/hire-invoice.entity';
import { BrokersService } from './brokers.service';
import { BrokersController } from './brokers.controller';

/**
 * الوحدة تُصدّر `BrokersService` لأنّ **فواتير الإيجار تستدعيها** بعد كلّ
 * حفظ لتُزامن الاستحقاقات. فالربط في اتّجاهٍ واحد: الفاتورة تعرف البروكر،
 * والبروكر لا يعرف من يستدعيه.
 */
@Module({
  imports: [
    CommonAuthzModule,
    TypeOrmModule.forFeature([Broker, BrokerRule, BrokerLedger, HireInvoice]),
  ],
  providers: [BrokersService],
  controllers: [BrokersController],
  exports: [BrokersService],
})
export class BrokersModule {}
