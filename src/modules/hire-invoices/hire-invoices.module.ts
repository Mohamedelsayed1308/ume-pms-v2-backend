import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HireInvoice } from './hire-invoice.entity';
import { HireInvoiceItem } from './hire-invoice-item.entity';
import { HirePayment } from './hire-payment.entity';
import { HireInvoicesController } from './hire-invoices.controller';

@Module({
  imports: [TypeOrmModule.forFeature([HireInvoice, HireInvoiceItem, HirePayment])],
  controllers: [HireInvoicesController],
  exports: [TypeOrmModule],
})
export class HireInvoicesModule {}
