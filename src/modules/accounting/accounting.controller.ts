import { Controller, Get, Post, Put, Body, Param, Query, Req, UseGuards } from '@nestjs/common';
import { AccountingService, CreateEntryDto } from './accounting.service';
import { JwtAuthGuard } from '../../common/jwt-auth.guard';
import { ScreenGuard } from '../../common/screen.guard';
import { RequireScreen } from '../../common/require-screen.decorator';
import {
  SCREEN_ACCOUNTING, SCREEN_ACCOUNTING_JOURNALS, SCREEN_ACCOUNTING_POSTING,
  SCREEN_ACCOUNTING_PERIODS, SCREEN_ACCOUNTING_SETUP,
} from './accounting.constants';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * P1.1A — واجهة المحاسبة
 *
 * التفويض **خادمي بالكامل** ولكل مسار شاشته: القراءة شيء، وإعداد المسوّدة شيء،
 * والترحيل شيء ثالث. المستخدم الذي يُعِدّ القيد لا يحتاج صلاحية ترحيله — وهذا
 * هو الفصل بين الواجبات مطبَّقاً بلا توسيع أدوار R2.
 *
 * ⚠️ لا مسار DELETE على القيود إطلاقاً. المسوّدة تُلغى (`void`)، والمُرحَّل يُعكس.
 * ═══════════════════════════════════════════════════════════════════════════
 */
@Controller('api/accounting')
@UseGuards(JwtAuthGuard, ScreenGuard)
export class AccountingController {
  constructor(private svc: AccountingService) {}

  private uid(req: any): string | null {
    return req?.user?.id ?? null;
  }

  // ── الإعداد ───────────────────────────────────────────────────────────────
  @Get('entities')
  @RequireScreen(SCREEN_ACCOUNTING, SCREEN_ACCOUNTING_SETUP)
  listEntities() { return this.svc.listEntities(); }

  @Post('entities')
  @RequireScreen(SCREEN_ACCOUNTING_SETUP)
  createEntity(@Body() body: any) { return this.svc.createEntity(body); }

  @Get('journals')
  @RequireScreen(SCREEN_ACCOUNTING, SCREEN_ACCOUNTING_JOURNALS, SCREEN_ACCOUNTING_SETUP)
  listJournals(@Query('legal_entity_id') id: string) { return this.svc.listJournals(id); }

  @Post('journals')
  @RequireScreen(SCREEN_ACCOUNTING_SETUP)
  createJournal(@Body() body: any) { return this.svc.createJournal(body); }

  @Post('fiscal-years')
  @RequireScreen(SCREEN_ACCOUNTING_SETUP)
  createFiscalYear(@Body() body: any) { return this.svc.createFiscalYear(body); }

  @Get('periods')
  @RequireScreen(SCREEN_ACCOUNTING, SCREEN_ACCOUNTING_PERIODS, SCREEN_ACCOUNTING_SETUP)
  listPeriods(@Query('legal_entity_id') id: string) { return this.svc.listPeriods(id); }

  @Get('accounts')
  @RequireScreen(SCREEN_ACCOUNTING, SCREEN_ACCOUNTING_JOURNALS, SCREEN_ACCOUNTING_SETUP)
  listAccounts(@Query('legal_entity_id') id: string) { return this.svc.listAccounts(id); }

  @Post('accounts')
  @RequireScreen(SCREEN_ACCOUNTING_SETUP)
  createAccount(@Body() body: any) { return this.svc.createAccount(body); }

  // إعداد لا حركة — على شاشة الإعداد وحدها.
  @Put('accounts/:id/system-role')
  @RequireScreen(SCREEN_ACCOUNTING_SETUP)
  setAccountRole(@Param('id') id: string, @Body() body: any) {
    return this.svc.setAccountSystemRole(id, body?.system_role ?? null);
  }

  @Get('fx-rates')
  @RequireScreen(SCREEN_ACCOUNTING, SCREEN_ACCOUNTING_JOURNALS, SCREEN_ACCOUNTING_SETUP)
  listFxRates(@Query('legal_entity_id') id: string) { return this.svc.listFxRates(id); }

  @Post('fx-rates')
  @RequireScreen(SCREEN_ACCOUNTING_SETUP)
  createFxRate(@Body() body: any, @Req() req: any) { return this.svc.createFxRate(body, this.uid(req)); }

  // الإنشاء على شاشة الإعداد والاعتماد على شاشة الترحيل — فصل الواجبات بالشاشات
  // القائمة، ويُشدَّد فوقه فصلٌ على مستوى المستخدم داخل الخدمة.
  @Post('fx-rates/:id/approve')
  @RequireScreen(SCREEN_ACCOUNTING_POSTING)
  approveFxRate(@Param('id') id: string, @Req() req: any) { return this.svc.approveFxRate(id, this.uid(req)); }

  // ── القيود ────────────────────────────────────────────────────────────────
  @Get('entries')
  @RequireScreen(SCREEN_ACCOUNTING, SCREEN_ACCOUNTING_JOURNALS, SCREEN_ACCOUNTING_POSTING)
  listEntries(@Query() q: any) { return this.svc.listEntries(q); }

  @Get('entries/:id')
  @RequireScreen(SCREEN_ACCOUNTING, SCREEN_ACCOUNTING_JOURNALS, SCREEN_ACCOUNTING_POSTING)
  getEntry(@Param('id') id: string) { return this.svc.getEntry(id); }

  @Post('entries')
  @RequireScreen(SCREEN_ACCOUNTING_JOURNALS)
  createDraft(@Body() body: CreateEntryDto, @Req() req: any) {
    return this.svc.createDraft(body, this.uid(req));
  }

  @Put('entries/:id')
  @RequireScreen(SCREEN_ACCOUNTING_JOURNALS)
  updateDraft(@Param('id') id: string, @Body() body: CreateEntryDto, @Req() req: any) {
    return this.svc.updateDraft(id, body, this.uid(req));
  }

  @Post('entries/:id/void')
  @RequireScreen(SCREEN_ACCOUNTING_JOURNALS)
  voidDraft(@Param('id') id: string, @Body() body: any, @Req() req: any) {
    return this.svc.voidDraft(id, body?.reason, this.uid(req));
  }

  /** الترحيل — شاشة مستقلة عن شاشة إعداد المسوّدات عمداً. */
  @Post('entries/:id/post')
  @RequireScreen(SCREEN_ACCOUNTING_POSTING)
  post(@Param('id') id: string, @Req() req: any) {
    return this.svc.post(id, this.uid(req));
  }

  @Post('entries/:id/reverse')
  @RequireScreen(SCREEN_ACCOUNTING_POSTING)
  reverse(@Param('id') id: string, @Body() body: any, @Req() req: any) {
    return this.svc.reverse(id, body, this.uid(req));
  }

  // ── الفترات ───────────────────────────────────────────────────────────────
  @Post('periods/:id/close')
  @RequireScreen(SCREEN_ACCOUNTING_PERIODS)
  closePeriod(@Param('id') id: string, @Body() body: any, @Req() req: any) {
    return this.svc.closePeriod(id, body, this.uid(req));
  }

  @Post('periods/:id/reopen')
  @RequireScreen(SCREEN_ACCOUNTING_PERIODS)
  reopenPeriod(@Param('id') id: string, @Body() body: any, @Req() req: any) {
    return this.svc.reopenPeriod(id, body, this.uid(req));
  }

  // ── التحقق ────────────────────────────────────────────────────────────────
  @Get('trial-balance')
  @RequireScreen(SCREEN_ACCOUNTING, SCREEN_ACCOUNTING_POSTING)
  trialBalance(@Query() q: any) { return this.svc.trialBalance(q); }
}
