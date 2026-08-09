import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MarketRecord } from './market-record.entity';
import { AgencyHistory } from './agency-history.entity';
import { MarketImportLog } from './market-import-log.entity';
import { MarketReport } from './market-report.entity';
import { MarketController } from './market.controller';
import { MarketService } from './market.service';
import { MarketImportService } from './market-import.service';
import { AgencyService } from './agency.service';
import { MarketReportService } from './market-report.service';
import { CommonAuthzModule } from '../../common/common-authz.module';

@Module({
  imports: [TypeOrmModule.forFeature([MarketRecord, AgencyHistory, MarketImportLog, MarketReport]), CommonAuthzModule],
  controllers: [MarketController],
  providers: [MarketService, MarketImportService, AgencyService, MarketReportService],
  exports: [MarketService, MarketImportService, AgencyService, MarketReportService],
})
export class MarketModule {}
