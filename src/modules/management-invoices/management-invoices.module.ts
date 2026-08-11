import { Module } from '@nestjs/common';
import { CommonAuthzModule } from '../../common/common-authz.module';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ManagementInvoice } from './management-invoice.entity';
import { ManagementPayment } from './management-payment.entity';
import { ManagementInvoicesController } from './management-invoices.controller';

@Module({
  imports: [CommonAuthzModule, TypeOrmModule.forFeature([ManagementInvoice, ManagementPayment])],
  controllers: [ManagementInvoicesController],
})
export class ManagementInvoicesModule {}
