import { Module } from '@nestjs/common';
import { CommonAuthzModule } from '../../common/common-authz.module';
import { TypeOrmModule } from '@nestjs/typeorm';
import { VesselProfitData } from './vessel-profit.entity';
import { VesselProfitService } from './vessel-profit.service';
import { VesselProfitController } from './vessel-profit.controller';
import { MonteIngestController } from './monte-ingest.controller';
import { MonteIngestService } from './monte-ingest.service';
import { MonteIngestGuard } from './monte-ingest.guard';
import { MonteInputsController } from './monte-inputs.controller';
import { MonteInputsService } from './monte-inputs.service';

@Module({
  imports: [CommonAuthzModule, TypeOrmModule.forFeature([VesselProfitData])],
  providers: [VesselProfitService, MonteIngestService, MonteIngestGuard, MonteInputsService],
  controllers: [VesselProfitController, MonteIngestController, MonteInputsController],
})
export class VesselProfitModule {}
