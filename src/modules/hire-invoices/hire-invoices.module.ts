import { Module } from '@nestjs/common';
import { CommonAuthzModule } from '../../common/common-authz.module';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HireInvoice } from './hire-invoice.entity';
import { HireInvoiceItem } from './hire-invoice-item.entity';
import { HirePayment } from './hire-payment.entity';
import { HireInvoicesController } from './hire-invoices.controller';
import { HirePaymentsService } from './hire-payments.service';

@Module({
  imports: [CommonAuthzModule, TypeOrmModule.forFeature([HireInvoice, HireInvoiceItem, HirePayment])],
  controllers: [HireInvoicesController],
  providers: [HirePaymentsService],
  exports: [TypeOrmModule],
})
export class HireInvoicesModule {}
