import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/jwt-auth.guard';
import { ScreenGuard } from '../../common/screen.guard';
import { RequireScreen } from '../../common/require-screen.decorator';
import { MonteInputsService } from './monte-inputs.service';

// مدخلات فريق مونتي — كلّ من يرى شاشة التقارير يُدخل (قرار المالك ١ نوفمبر ٢٠٢٦)
@Controller('api/vessel-profit-inputs')
@UseGuards(JwtAuthGuard, ScreenGuard)
@RequireScreen('/dashboard/reports')
export class MonteInputsController {
  constructor(private svc: MonteInputsService) {}

  @Get('monte')
  list() {
    return this.svc.list();
  }

  @Post('monte')
  add(@Body() body: { kind?: unknown; data?: unknown }, @Req() req: any) {
    return this.svc.add(body?.kind, body?.data, req?.user);
  }

  @Post('monte/:id/void')
  void(@Param('id', ParseUUIDPipe) id: string, @Body() body: { reason?: unknown }, @Req() req: any) {
    return this.svc.void(id, body?.reason, req?.user);
  }
}
