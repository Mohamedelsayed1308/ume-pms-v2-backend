import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CommonAuthzModule } from '../../common/common-authz.module';
import { AccountingController } from './accounting.controller';
import { AccountingBridgeController } from './bridge/accounting-bridge.controller';
import { AccountingBridgeService } from './bridge/accounting-bridge.service';
import { AccountingService } from './accounting.service';
import { LegalEntity } from './entities/legal-entity.entity';
import { CostCenter } from './entities/cost-center.entity';
import { AccountingAccount } from './entities/accounting-account.entity';
import { Journal } from './entities/journal.entity';
import { FiscalYear } from './entities/fiscal-year.entity';
import { FiscalPeriod } from './entities/fiscal-period.entity';
import { AccountingFxRate } from './entities/accounting-fx-rate.entity';
import { JournalEntry } from './entities/journal-entry.entity';
import { JournalLine } from './entities/journal-line.entity';

/**
 * وحدة المحاسبة — **معزولة تماماً**: لا تستورد أي وحدة أعمال من PMS ولا تُستورَد
 * منها. P1.1A لا يرحّل فاتورة ولا سداداً تلقائياً، والعزل يجعل ذلك حقيقة بنيوية
 * لا وعداً في وثيقة.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      LegalEntity, CostCenter, AccountingAccount, Journal,
      FiscalYear, FiscalPeriod, AccountingFxRate, JournalEntry, JournalLine,
    ]),
    CommonAuthzModule,
  ],
  controllers: [AccountingController, AccountingBridgeController],
  providers: [AccountingService, AccountingBridgeService],
})
export class AccountingModule {}
