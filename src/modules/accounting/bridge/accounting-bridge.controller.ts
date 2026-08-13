import { Controller, Get, Post, Put, Body, Param, Query, Req, UseGuards } from '@nestjs/common';
import { AccountingBridgeService } from './accounting-bridge.service';
import { JwtAuthGuard } from '../../../common/jwt-auth.guard';
import { ScreenGuard } from '../../../common/screen.guard';
import { RequireScreen } from '../../../common/require-screen.decorator';
import { SCREEN_ACCOUNTING_JOURNALS } from '../accounting.constants';

/**
 * الجسر يُنشئ **مسوّدات** فقط — فشاشته شاشة إعداد القيود لا شاشة الترحيل.
 * الترحيل يبقى على `POST /api/accounting/entries/:id/post` بصلاحيته المستقلة،
 * فمن يُعِدّ لا يُرحّل بالضرورة.
 */
@Controller('api/accounting/bridge')
@UseGuards(JwtAuthGuard, ScreenGuard)
@RequireScreen(SCREEN_ACCOUNTING_JOURNALS)
export class AccountingBridgeController {
  constructor(private svc: AccountingBridgeService) {}

  private uid(req: any): string | null { return req?.user?.id ?? null; }

  @Post('supplier-invoice/:id')
  supplierInvoice(@Param('id') id: string, @Body() body: any, @Req() req: any) {
    return this.svc.postSupplierInvoice(id, body, this.uid(req));
  }

  @Post('supplier-payment/:id')
  supplierPayment(@Param('id') id: string, @Body() body: any, @Req() req: any) {
    return this.svc.postSupplierPayment(id, body, this.uid(req));
  }

  @Post('hire-invoice/:id')
  hireInvoice(@Param('id') id: string, @Body() body: any, @Req() req: any) {
    return this.svc.postHireInvoice(id, body, this.uid(req));
  }

  @Get('supplier-defaults')
  listSupplierDefaults(@Query('legal_entity_id') id: string) { return this.svc.listSupplierDefaults(id); }

  @Put('supplier-defaults')
  setSupplierDefault(@Body() body: any, @Req() req: any) { return this.svc.setSupplierDefault(body, this.uid(req)); }

  @Post('depreciation')
  depreciation(@Body() body: any, @Req() req: any) { return this.svc.postDepreciation(body, this.uid(req)); }

  @Get('depreciation/schedules')
  listSchedules(@Query('legal_entity_id') id: string) { return this.svc.listDepreciationSchedules(id); }

  @Put('depreciation/schedules')
  setSchedule(@Body() body: any, @Req() req: any) { return this.svc.setDepreciationSchedule(body, this.uid(req)); }

  @Post('depreciation/schedules/:id/deactivate')
  deactivateSchedule(@Param('id') id: string) { return this.svc.deactivateDepreciationSchedule(id); }

  // اللحاق يُستدعى كلّما فُتحت شاشة المحاسبة. آمنٌ للتكرار: يُنشئ ما ينقص فقط.
  @Post('depreciation/catch-up')
  catchUp(@Body() body: any, @Req() req: any) {
    const today = new Date().toISOString().slice(0, 10);
    return this.svc.catchUpDepreciation(String(body?.legal_entity_id || ''), today, this.uid(req));
  }

  @Post('revenue-release')
  revenueRelease(@Body() body: any, @Req() req: any) {
    return this.svc.releaseEarnedRevenue(body, this.uid(req));
  }
}
