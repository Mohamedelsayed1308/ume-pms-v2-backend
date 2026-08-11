import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards, Request } from '@nestjs/common';
import { InvoicesService } from './invoices.service';
import { JwtAuthGuard } from '../../common/jwt-auth.guard';
import { ScreenGuard } from '../../common/screen.guard';
import { RequireScreen } from '../../common/require-screen.decorator';
import { rejectSystemControlledFields } from '../../common/financial-control-fields';

@Controller('api/invoices')
@UseGuards(JwtAuthGuard, ScreenGuard)
@RequireScreen('/dashboard/invoices', '/dashboard/reports')
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
  @Get('report/by-user') reportByUser() { return this.svc.reportByUser(); }
  @Get('report/department-delays') reportDepartmentDelays() { return this.svc.reportDepartmentDelays(); }
  @Get(':id') findOne(@Param('id') id: string) { return this.svc.findOne(id); }
  @RequireScreen('/dashboard/invoices')
  @Post() create(@Body() body: any, @Request() req: any) {
    rejectSystemControlledFields(body);   // الطبقة 1 — رفض عند الحدّ
    return this.svc.create({ ...body, created_by_id: req.user?.id, created_by_name: req.user?.full_name || req.user?.email });
  }
  @RequireScreen('/dashboard/invoices')
  @Put(':id') update(@Param('id') id: string, @Body() body: any) {
    rejectSystemControlledFields(body);   // الطبقة 1 — رفض عند الحدّ
    return this.svc.update(id, body);
  }
  @RequireScreen('/dashboard/invoices')
  @Delete(':id') remove(@Param('id') id: string) { return this.svc.remove(id); }
}
