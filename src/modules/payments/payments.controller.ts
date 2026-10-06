import { Controller, Get, Post, Delete, Body, Param, Req, UseGuards } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { JwtAuthGuard } from '../../common/jwt-auth.guard';
import { ScreenGuard } from '../../common/screen.guard';
import { RequireScreen } from '../../common/require-screen.decorator';

@Controller('api/payments')
@UseGuards(JwtAuthGuard, ScreenGuard)
@RequireScreen('/dashboard/payments')
export class PaymentsController {
  constructor(private svc: PaymentsService) {}

  @Get() findAll() { return this.svc.findAll(); }
  // تطبيقات الإشعارات الدائنة — قبل ':id' حتّى لا تُقرأ «allocations» معرّفَ سداد
  @Get('allocations') allocations() { return this.svc.listAllocations(); }
  @Post('batch') batch(@Body() body: any, @Req() req: any) { return this.svc.createBatch(body, String(req.user?.full_name || req.user?.email || '')); }
  @Delete('allocations/:id') removeAllocation(@Param('id') id: string) { return this.svc.removeAllocation(id); }
  @Get('by-invoice/:id') byInvoice(@Param('id') id: string) { return this.svc.findByInvoice(id); }
  @Get(':id') findOne(@Param('id') id: string) { return this.svc.findOne(id); }
  @Post() create(@Body() body: any) { return this.svc.create(body); }
  @Delete(':id') remove(@Param('id') id: string) { return this.svc.remove(id); }
}
