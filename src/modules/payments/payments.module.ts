import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Payment } from './payment.entity';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { InvoicesModule } from '../invoices/invoices.module';
import { CommonAuthzModule } from '../../common/common-authz.module';

@Module({
  imports: [TypeOrmModule.forFeature([Payment]), InvoicesModule, CommonAuthzModule],
  controllers: [PaymentsController],
  providers: [PaymentsService],
})
export class PaymentsModule {}
