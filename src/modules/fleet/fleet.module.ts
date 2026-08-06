import { Module } from '@nestjs/common';
import { FleetService } from './fleet.service';
import { FleetController } from './fleet.controller';

@Module({
  providers: [FleetService],
  controllers: [FleetController],
})
export class FleetModule {}
