import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { InvoicesService } from './invoices.service';
import { JwtAuthGuard } from '../../common/jwt-auth.guard';

@Controller('api/invoices')
@UseGuards(JwtAuthGuard)
export class InvoicesController {
  constructor(private svc: InvoicesService) {}

  @Get() findAll() { return this.svc.findAll(); }
  @Get('alerts/due') dueAlerts(@Query('days') days?: string) {
    return this.svc.getDueAlerts(days ? parseInt(days) : 30);
  }
  @Get('by-supplier/:id') bySupplier(@Param('id') id: string) { return this.svc.findBySupplier(id); }
  @Get('by-vessel/:id') byVessel(@Param('id') id: string) { return this.svc.findByVessel(id); }
  @Get('statement/supplier/:id') supplierStatement(@Param('id') id: string) { return this.svc.getSupplierStatement(id); }
  @Get('unpaid/by-supplier/:id') unpaidBySupplier(@Param('id') id: string) { return this.svc.findUnpaidBySupplier(id); }
  @Get('unpaid/by-vessel/:id') unpaidByVessel(@Param('id') id: string) { return this.svc.findUnpaidByVessel(id); }
  @Get(':id') findOne(@Param('id') id: string) { return this.svc.findOne(id); }
  @Post() create(@Body() body: any) { return this.svc.create(body); }
  @Put(':id') update(@Param('id') id: string, @Body() body: any) { return this.svc.update(id, body); }
  @Delete(':id') remove(@Param('id') id: string) { return this.svc.remove(id); }
}
