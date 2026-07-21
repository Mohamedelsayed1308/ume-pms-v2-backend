import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ManagementInvoice } from './management-invoice.entity';
import { ManagementPayment } from './management-payment.entity';
import { ManagementInvoicesController } from './management-invoices.controller';

@Module({
  imports: [TypeOrmModule.forFeature([ManagementInvoice, ManagementPayment])],
  controllers: [ManagementInvoicesController],
})
export class ManagementInvoicesModule {}
