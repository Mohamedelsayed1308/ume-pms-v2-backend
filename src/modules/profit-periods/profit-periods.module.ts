import { Module } from '@nestjs/common';
import { CommonAuthzModule } from '../../common/common-authz.module';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProfitPeriod } from './profit-period.entity';
import { ProfitSettlement } from './profit-settlement.entity';
import { ProfitPeriodsService } from './profit-periods.service';
import { ProfitRatificationService } from './profit-ratification.service';
import { ProfitPeriodsController } from './profit-periods.controller';

@Module({
  imports: [CommonAuthzModule, TypeOrmModule.forFeature([ProfitPeriod, ProfitSettlement])],
  providers: [ProfitPeriodsService, ProfitRatificationService],
  controllers: [ProfitPeriodsController],
})
export class ProfitPeriodsModule {}
