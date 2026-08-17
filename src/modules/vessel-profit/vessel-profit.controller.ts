import { Controller, Get, Put, Param, Body, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/jwt-auth.guard';
import { ScreenGuard } from '../../common/screen.guard';
import { RequireScreen } from '../../common/require-screen.decorator';
import { VesselProfitService } from './vessel-profit.service';

@Controller('api/vessel-profit')
@UseGuards(JwtAuthGuard, ScreenGuard)
@RequireScreen('/dashboard/reports')
export class VesselProfitController {
  constructor(private svc: VesselProfitService) {}

  @Get(':vessel')
  get(@Param('vessel') vessel: string) {
    return this.svc.get(vessel);
  }

  // الرحلات من الشيت الموحّد — المصدر الافتراضي، والرفع اليدوي يبقى بديلاً
  @Get(':vessel/from-sheet')
  fromSheet(@Param('vessel') vessel: string) {
    return this.svc.fromSheet(vessel);
  }

  @RequireScreen('/dashboard/reports')
  @Put(':vessel')
  save(@Param('vessel') vessel: string, @Body() body: { voyages?: any; manual?: any }) {
    return this.svc.save(vessel, body || {});
  }
}
