import { Controller, Get, Post, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { JwtAuthGuard } from '../../common/jwt-auth.guard';

@Controller('api/payments')
@UseGuards(JwtAuthGuard)
export class PaymentsController {
  constructor(private svc: PaymentsService) {}

  @Get() findAll() { return this.svc.findAll(); }
  @Get('by-invoice/:id') byInvoice(@Param('id') id: string) { return this.svc.findByInvoice(id); }
  @Get(':id') findOne(@Param('id') id: string) { return this.svc.findOne(id); }
  @Post() create(@Body() body: any) { return this.svc.create(body); }
  @Delete(':id') remove(@Param('id') id: string) { return this.svc.remove(id); }
}
