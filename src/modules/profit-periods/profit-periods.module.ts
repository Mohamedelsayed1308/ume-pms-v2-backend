import { Module } from '@nestjs/common';
import { CommonAuthzModule } from '../../common/common-authz.module';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProfitPeriod } from './profit-period.entity';
import { ProfitPeriodsService } from './profit-periods.service';
import { ProfitPeriodsController } from './profit-periods.controller';

@Module({
  imports: [CommonAuthzModule, TypeOrmModule.forFeature([ProfitPeriod])],
  providers: [ProfitPeriodsService],
  controllers: [ProfitPeriodsController],
})
export class ProfitPeriodsModule {}
