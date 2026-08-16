import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AccountingReportsService } from './reports.service';
import { JwtAuthGuard } from '../../../common/jwt-auth.guard';
import { ScreenGuard } from '../../../common/screen.guard';
import { RequireScreen } from '../../../common/require-screen.decorator';
import { SCREEN_ACCOUNTING, SCREEN_ACCOUNTING_POSTING, SCREEN_ACCOUNTING_REPORTS } from '../accounting.constants';

@Controller('api/accounting/reports')
@UseGuards(JwtAuthGuard, ScreenGuard)
/*
 * شاشة التقارير ضمن القائمة: مطابقة الشاشات تامّة لا بادئة، فمنح
 * المستخدم شاشة «تقارير الدفتر» وحدها كان يريه الرابط وتردّ نداءاته 403.
 */
@RequireScreen(SCREEN_ACCOUNTING, SCREEN_ACCOUNTING_POSTING, SCREEN_ACCOUNTING_REPORTS)
export class AccountingReportsController {
  constructor(private svc: AccountingReportsService) {}

  @Get('statements')
  statements(@Query() q: any) { return this.svc.statements(q); }

  /*
   * التفصيل والملخّص من نداءٍ واحد.
   *
   * الملخّص مشتقٌّ من التفصيل لا محسوبٌ على حدة، فإفرادُه بنقطة نهاية يفتح باب
   * اختلافهما — وتقريران متناقضان عن الشيء نفسه أسوأ من تقرير واحد ناقص.
   */
  @Get('vendor-balance')
  vendorBalance(@Query() q: any) { return this.svc.vendorBalance(q); }

  @Get('customer-balance')
  customerBalance(@Query() q: any) { return this.svc.customerBalance(q); }

  @Get('general-ledger')
  generalLedger(@Query() q: any) { return this.svc.generalLedger(q); }
}
