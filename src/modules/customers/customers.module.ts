import { Module } from '@nestjs/common';
import { CommonAuthzModule } from '../../common/common-authz.module';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Customer } from './customer.entity';
import { CustomersController } from './customers.controller';

@Module({
  imports: [CommonAuthzModule, TypeOrmModule.forFeature([Customer])],
  controllers: [CustomersController],
  exports: [TypeOrmModule],
})
export class CustomersModule {}
