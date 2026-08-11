import { Module } from '@nestjs/common';
import { CommonAuthzModule } from '../../common/common-authz.module';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Supplier } from './supplier.entity';
import { Invoice } from '../invoices/invoice.entity';
import { PurchaseOrder } from '../purchase-orders/purchase-order.entity';
import { SuppliersController } from './suppliers.controller';
import { SuppliersService } from './suppliers.service';

@Module({
  imports: [CommonAuthzModule, TypeOrmModule.forFeature([Supplier, Invoice, PurchaseOrder])],
  controllers: [SuppliersController],
  providers: [SuppliersService],
  exports: [SuppliersService],
})
export class SuppliersModule {}
