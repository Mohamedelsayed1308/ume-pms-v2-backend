import { Controller, Get, Post, Body, Param, Query, Req, UseGuards } from '@nestjs/common';
import { ReceiptsService } from './receipts.service';
import { JwtAuthGuard } from '../../common/jwt-auth.guard';
import { ScreenGuard } from '../../common/screen.guard';
import { RequireScreen } from '../../common/require-screen.decorator';

// الاستلام واقعة تشغيلية يسجّلها من يتعامل مع الفاتورة — لا شاشة محاسبية.
// وهو **ليس اعتماد صرف**: من يؤكّد الاستلام لا يعتمد الدفع بالضرورة.
@Controller('api')
@UseGuards(JwtAuthGuard, ScreenGuard)
export class ReceiptsController {
  constructor(private svc: ReceiptsService) {}

  private uid(req: any): string | null { return req?.user?.id ?? req?.user?.sub ?? null; }
  private uname(req: any): string | null { return req?.user?.name ?? req?.user?.username ?? null; }

  // قائمة عمل الاستلام — استعلام واحد بدل نداء لكل فاتورة.
  @Get('receipts/pending')
  @RequireScreen('/dashboard/receipts', '/dashboard/invoices')
  pending(@Query() q: any) { return this.svc.pending(q); }

  @Get('receipts/summary')
  @RequireScreen('/dashboard/receipts', '/dashboard/invoices')
  summary() { return this.svc.pendingSummary(); }

  @Get('invoices/:id/receipts')
  @RequireScreen('/dashboard/invoices', '/dashboard/receipts')
  list(@Param('id') id: string) { return this.svc.list(id); }

  @Post('invoices/:id/receipts')
  @RequireScreen('/dashboard/invoices', '/dashboard/receipts')
  create(@Param('id') id: string, @Body() body: any, @Req() req: any) {
    return this.svc.create(id, body, this.uid(req), this.uname(req));
  }

  @Get('invoices/:id/accrual-eligibility')
  @RequireScreen('/dashboard/invoices', '/dashboard/receipts')
  eligibility(@Param('id') id: string, @Query() q: any) { return this.svc.eligibility(id, q); }
}
