import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Invoice } from './invoice.entity';
import { ImportBatch } from './import-batch.entity';
import { Attachment } from '../attachments/attachment.entity';
import { InvoicesController } from './invoices.controller';
import { InvoicesService } from './invoices.service';
import { InvoiceExtractController } from './invoice-extract.controller';
import { InvoicesAssistantController } from './invoices-assistant.controller';
import { CommonAuthzModule } from '../../common/common-authz.module';

@Module({
  imports: [TypeOrmModule.forFeature([Invoice, Attachment, ImportBatch]), CommonAuthzModule],
  controllers: [InvoicesController, InvoiceExtractController, InvoicesAssistantController],
  providers: [InvoicesService],
  exports: [InvoicesService],
})
export class InvoicesModule {}
