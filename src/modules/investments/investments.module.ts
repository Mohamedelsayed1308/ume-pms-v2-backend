import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  StoneRound, StoneParentLedger, StoneInvestmentLedger, StoneBankConfirmation,
  StoneFundCall, StoneVessel, StoneOpenItem, StoneInterestTerm,
} from './stone.entity';
import { InvestmentsService } from './investments.service';
import { InvestmentsController } from './investments.controller';

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
      StoneFundCall, StoneVessel, StoneOpenItem, StoneInterestTerm,
    ]),
  ],
  providers: [InvestmentsService],
  controllers: [InvestmentsController],
})
export class InvestmentsModule {}
