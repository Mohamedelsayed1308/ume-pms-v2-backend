import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { VesselProfitData } from './vessel-profit.entity';
import { VesselProfitService } from './vessel-profit.service';
import { VesselProfitController } from './vessel-profit.controller';

@Module({
  imports: [TypeOrmModule.forFeature([VesselProfitData])],
  providers: [VesselProfitService],
  controllers: [VesselProfitController],
})
export class VesselProfitModule {}
