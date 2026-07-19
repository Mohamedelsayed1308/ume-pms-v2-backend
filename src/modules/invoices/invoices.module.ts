import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Invoice } from './invoice.entity';
import { Attachment } from '../attachments/attachment.entity';
import { InvoicesController } from './invoices.controller';
import { InvoicesService } from './invoices.service';
import { InvoiceExtractController } from './invoice-extract.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Invoice, Attachment])],
  controllers: [InvoicesController, InvoiceExtractController],
  providers: [InvoicesService],
  exports: [InvoicesService],
})
export class InvoicesModule {}
