import { Controller, Get, Post, Body, Param, Query, Req, UseGuards } from '@nestjs/common';
import { ReceiptsService } from './receipts.service';
import { JwtAuthGuard } from '../../common/jwt-auth.guard';
import { ScreenGuard } from '../../common/screen.guard';
import { RequireScreen } from '../../common/require-screen.decorator';

// الاستلام واقعة تشغيلية يسجّلها من يتعامل مع الفاتورة — لا شاشة محاسبية.
// وهو **ليس اعتماد صرف**: من يؤكّد الاستلام لا يعتمد الدفع بالضرورة.
@Controller('api/invoices')
@UseGuards(JwtAuthGuard, ScreenGuard)
@RequireScreen('/dashboard/invoices')
export class ReceiptsController {
  constructor(private svc: ReceiptsService) {}

  private uid(req: any): string | null { return req?.user?.id ?? req?.user?.sub ?? null; }
  private uname(req: any): string | null { return req?.user?.name ?? req?.user?.username ?? null; }

  @Get(':id/receipts')
  list(@Param('id') id: string) { return this.svc.list(id); }

  @Post(':id/receipts')
  create(@Param('id') id: string, @Body() body: any, @Req() req: any) {
    return this.svc.create(id, body, this.uid(req), this.uname(req));
  }

  @Get(':id/accrual-eligibility')
  eligibility(@Param('id') id: string, @Query() q: any) { return this.svc.eligibility(id, q); }
}
