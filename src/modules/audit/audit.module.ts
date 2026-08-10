import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Invoice } from '../invoices/invoice.entity';
import { Payment } from '../payments/payment.entity';
import { AuditController } from './audit.controller';
import { AuditService } from './audit.service';

// وحدة معزولة تماماً: لا تعتمد على أي خدمة أخرى ولا تُصدِّر شيئاً،
// فالتراجع عنها = إزالة السطر من app.module بلا أي أثر على باقي النظام.
@Module({
  imports: [TypeOrmModule.forFeature([Invoice, Payment])],
  controllers: [AuditController],
  providers: [AuditService],
})
export class AuditModule {}
