import {
  Controller, Get, Post, Put, Delete, Body, Param, Query, Req,
  HttpException, UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/jwt-auth.guard';
import { ScreenGuard } from '../../common/screen.guard';
import { RequireScreen } from '../../common/require-screen.decorator';
import { ProfitPeriodsService } from './profit-periods.service';
import { ProfitRatificationService } from './profit-ratification.service';

@Controller('api/profit-periods')
@UseGuards(JwtAuthGuard, ScreenGuard)
@RequireScreen('/dashboard/profit-distribution')
export class ProfitPeriodsController {
  constructor(
    private svc: ProfitPeriodsService,
    private ratify: ProfitRatificationService,
  ) {}

  private who(req: any): string {
    return String(req?.user?.username || req?.user?.email || req?.user?.id || '');
  }

  private async needPeriod(id: string) {
    const p = await this.svc.findOne(id);
    if (!p) throw new HttpException('الفترة غير موجودة', 404);
    return p;
  }

  @Get()
  findAll() { return this.svc.findAll(); }

  @Get('voyage-dates')
  async voyageDates(@Query('from') from: string, @Query('to') to: string) {
    return this.svc.fetchVoyageDates(Number(from), Number(to));
  }

  @Get(':id')
  findOne(@Param('id') id: string) { return this.svc.findOne(id); }

  @Post()
  create(@Body() body: any) { return this.svc.create(body); }

  @Put(':id')
  update(@Param('id') id: string, @Body() body: any) { return this.svc.update(id, body); }

  @Delete(':id')
  remove(@Param('id') id: string) { return this.svc.remove(id); }

  /*
   * ── المصادقة والرصيد التراكميّ ─────────────────────────────────────────
   *
   * المُصادَق عليه هو **الرقم الذي يُحوَّل إلى البنك**. فبعدها تُقفل الفترة:
   * لا يكتب فيها حفظٌ ولا جلب، والسحب الجديد يستقرّ في لقطةٍ ثانية ويُقارَن.
   */

  /** دفتر الفروق كاملاً — ومعه الرصيد الجاري للشريكين. */
  @Get('settlements/statement')
  statement() { return this.ratify.statement(); }

  /** تحويلٌ فعليّ إلى الحساب البنكيّ — يُقيَّد يداً، فالمستحقّ لا يُحوَّل كلّه دائماً. */
  @Post('settlements/payment')
  payment(
    @Body() body: { partner: string; amount: number; note?: string; periodId?: string | null },
    @Req() req: any,
  ) {
    return this.ratify.recordPayment(body, this.who(req));
  }

  /** حذفُ قيدِ تحويلٍ أُدخل خطأً — بسببٍ مكتوب. */
  @Post('settlements/payment/:id/delete')
  deletePayment(
    @Param('id') id: string,
    @Body() body: { reason?: string },
    @Req() req: any,
  ) {
    return this.ratify.deletePayment(id, String(body?.reason || ''), this.who(req));
  }

  /** الرصيد الافتتاحيّ — ما تراكم قبل أن يوجد النظام. يُقيَّد مرّةً واحدة. */
  @Post('settlements/opening')
  opening(
    @Body() body: { entries?: { partner: string; amount: number; note?: string }[] },
    @Req() req: any,
  ) {
    return this.ratify.openBalance(body?.entries || [], this.who(req));
  }

  @Post(':id/ratify')
  async doRatify(@Param('id') id: string, @Req() req: any) {
    const period = await this.needPeriod(id);
    const r = this.svc.calculate(period);
    return this.ratify.ratify(
      period, { distribution: r, proposed: r.proposed }, this.who(req),
    );
  }

  @Post(':id/unratify')
  async doUnratify(@Param('id') id: string, @Body() body: { reason?: string }, @Req() req: any) {
    const period = await this.needPeriod(id);
    return this.ratify.unratify(period, String(body?.reason || ''), this.who(req));
  }

  /**
   * يُسجّل سحباً جديداً على فترةٍ مُصادَقة ويقيّد الفرق.
   *
   * والمدخلات تأتي من الشاشة لأنّ مدى الرحلات اختيارُ مستخدمٍ لا يُخزَّن —
   * لكنّ **الحساب يجري هنا** بالمحرّك نفسه، فلا يُقيَّد رقمٌ حسبه العميل.
   */
  @Post(':id/record-latest')
  async recordLatest(
    @Param('id') id: string,
    @Body() body: { fields?: any; fetchedAt?: string },
    @Req() req: any,
  ) {
    const period = await this.needPeriod(id);
    if (!body?.fields) throw new HttpException('لا مدخلاتٍ للمقارنة', 400);
    const probe = { ...period, ...body.fields, id: period.id } as any;
    const r = this.svc.calculate(probe);
    return this.ratify.recordLatest(
      period, { distribution: r, proposed: r.proposed }, this.who(req), body.fetchedAt,
    );
  }

  @Get(':id/calculate')
  async calculate(@Param('id') id: string) {
    const period = await this.svc.findOne(id);
    if (!period) return { error: 'Not found' };
    return this.svc.calculate(period);
  }

  // القراءة من الشيت الموحّد — بديلٌ لمسار إكسل درايف بالشكل نفسه
  @Post('fetch-sheet')
  async fetchSheet(@Body() body: {
    date_from: string; date_to: string;
    ranges?: Record<string, { from?: number; to?: number }>;
    line?: string;
  }) {
    if (!body?.date_from || !body?.date_to) {
      throw new HttpException('الفترة الزمنية مطلوبة', 400);
    }
    try {
      return await this.svc.fetchFromUnifiedSheet(
        body.date_from, body.date_to, body.ranges, body.line,
      );
    } catch (e: any) {
      throw new HttpException(e?.message || 'تعذّر الجلب من الشيت', 502);
    }
  }

  @Post('fetch-excel')
  async fetchExcel(@Body() body: { file_id: string; date_from: string; date_to: string; voy_from?: number; voy_to?: number }) {
    try {
      return await this.svc.fetchFromGoogleDrive(body.file_id, body.date_from, body.date_to, body.voy_from, body.voy_to);
    } catch (e: any) {
      const msg = e?.response?.data ? `HTTP ${e.response.status}` : e?.message || 'Unknown error';
      throw new (await import('@nestjs/common').then(m => m.HttpException))(
        { message: msg, detail: e?.message },
        500,
      );
    }
  }
}
