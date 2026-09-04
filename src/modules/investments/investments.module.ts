import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  StoneRound, StoneParentLedger, StoneInvestmentLedger, StoneBankConfirmation,
  StoneFundCall, StoneVessel, StoneOpenItem, StoneInterestTerm, StoneFundReport,
} from './stone.entity';
import { InvestmentsService } from './investments.service';
import { InvestmentsController } from './investments.controller';
import { StoneReportService } from './stone-report.service';

/**
 * وحدة كارت Stone.
 *
 * ولا `CommonAuthzModule`: الحدُّ هنا **دورُ أدمن** يُفحص في الكنترولر، لا
 * شاشةٌ تُمنح في `allowed_screens`. فلا خدمةَ صلاحياتٍ تُحقن.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      StoneRound, StoneParentLedger, StoneInvestmentLedger, StoneBankConfirmation,
      StoneFundCall, StoneVessel, StoneOpenItem, StoneInterestTerm, StoneFundReport,
    ]),
  ],
  providers: [InvestmentsService, StoneReportService],
  controllers: [InvestmentsController],
})
export class InvestmentsModule {}
