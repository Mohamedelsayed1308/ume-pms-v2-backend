import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProfitPeriod } from './profit-period.entity';
import { ProfitPeriodsService } from './profit-periods.service';
import { ProfitPeriodsController } from './profit-periods.controller';

@Module({
  imports: [TypeOrmModule.forFeature([ProfitPeriod])],
  providers: [ProfitPeriodsService],
  controllers: [ProfitPeriodsController],
})
export class ProfitPeriodsModule {}
