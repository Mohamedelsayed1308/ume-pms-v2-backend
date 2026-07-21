import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ShippingCompany } from './shipping-company.entity';
import { ShippingCompaniesController } from './shipping-companies.controller';

@Module({
  imports: [TypeOrmModule.forFeature([ShippingCompany])],
  controllers: [ShippingCompaniesController],
  exports: [TypeOrmModule],
})
export class ShippingCompaniesModule {}
