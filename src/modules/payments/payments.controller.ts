import { Controller, Get, Post, Delete, Body, Param, UseGuards } from '@nestjs/common';
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
  @Get('by-invoice/:id') byInvoice(@Param('id') id: string) { return this.svc.findByInvoice(id); }
  @Get(':id') findOne(@Param('id') id: string) { return this.svc.findOne(id); }
  @Post() create(@Body() body: any) { return this.svc.create(body); }
  @Delete(':id') remove(@Param('id') id: string) { return this.svc.remove(id); }
}
