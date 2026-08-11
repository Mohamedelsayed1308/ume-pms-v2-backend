import { Module } from '@nestjs/common';
import { CommonAuthzModule } from '../../common/common-authz.module';
import { TypeOrmModule } from '@nestjs/typeorm';
import { VesselProfitData } from './vessel-profit.entity';
import { VesselProfitService } from './vessel-profit.service';
import { VesselProfitController } from './vessel-profit.controller';

@Module({
  imports: [CommonAuthzModule, TypeOrmModule.forFeature([VesselProfitData])],
  providers: [VesselProfitService],
  controllers: [VesselProfitController],
})
export class VesselProfitModule {}
