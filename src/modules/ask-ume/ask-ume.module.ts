import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Invoice } from '../invoices/invoice.entity';
import { Payment } from '../payments/payment.entity';
import { Supplier } from '../suppliers/supplier.entity';
import { Vessel } from '../vessels/vessel.entity';
import { Task } from '../tasks/task.entity';
import { User } from '../auth/user.entity';
import { AskUmeService } from './ask-ume.service';
import { AskUmeController } from './ask-ume.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Invoice, Payment, Supplier, Vessel, Task, User])],
  providers: [AskUmeService],
  controllers: [AskUmeController],
})
export class AskUmeModule {}
