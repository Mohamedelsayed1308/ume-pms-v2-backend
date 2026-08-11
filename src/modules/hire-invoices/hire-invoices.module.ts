import { Module } from '@nestjs/common';
import { CommonAuthzModule } from '../../common/common-authz.module';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HireInvoice } from './hire-invoice.entity';
import { HireInvoiceItem } from './hire-invoice-item.entity';
import { HirePayment } from './hire-payment.entity';
import { HireInvoicesController } from './hire-invoices.controller';

@Module({
  imports: [CommonAuthzModule, TypeOrmModule.forFeature([HireInvoice, HireInvoiceItem, HirePayment])],
  controllers: [HireInvoicesController],
  exports: [TypeOrmModule],
})
export class HireInvoicesModule {}
