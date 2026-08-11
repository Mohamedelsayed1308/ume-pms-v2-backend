import { Module } from '@nestjs/common';
import { CommonAuthzModule } from '../../common/common-authz.module';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ShippingCompany } from './shipping-company.entity';
import { ShippingCompaniesController } from './shipping-companies.controller';

@Module({
  imports: [CommonAuthzModule, TypeOrmModule.forFeature([ShippingCompany])],
  controllers: [ShippingCompaniesController],
  exports: [TypeOrmModule],
})
export class ShippingCompaniesModule {}
