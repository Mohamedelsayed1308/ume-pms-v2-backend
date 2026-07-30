import { Controller, Get, Put, Param, Body, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/jwt-auth.guard';
import { VesselProfitService } from './vessel-profit.service';

@Controller('api/vessel-profit')
@UseGuards(JwtAuthGuard)
export class VesselProfitController {
  constructor(private svc: VesselProfitService) {}

  @Get(':vessel')
  get(@Param('vessel') vessel: string) {
    return this.svc.get(vessel);
  }

  @Put(':vessel')
  save(@Param('vessel') vessel: string, @Body() body: { voyages?: any; manual?: any }) {
    return this.svc.save(vessel, body || {});
  }
}
