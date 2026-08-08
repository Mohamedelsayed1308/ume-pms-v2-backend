import { Module } from '@nestjs/common';
import { FleetService } from './fleet.service';
import { FleetController } from './fleet.controller';
import { CommonAuthzModule } from '../../common/common-authz.module';

@Module({
  imports: [CommonAuthzModule],
  providers: [FleetService],
  controllers: [FleetController],
})
export class FleetModule {}
