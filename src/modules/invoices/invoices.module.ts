import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MulterModule } from '@nestjs/platform-express';
import { Invoice } from './invoice.entity';
import { InvoicesController } from './invoices.controller';
import { InvoicesService } from './invoices.service';
import { InvoiceExtractController } from './invoice-extract.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Invoice]), MulterModule.register()],
  controllers: [InvoicesController, InvoiceExtractController],
  providers: [InvoicesService],
  exports: [InvoicesService],
})
export class InvoicesModule {}
