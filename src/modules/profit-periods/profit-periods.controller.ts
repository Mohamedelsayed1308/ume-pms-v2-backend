import { Controller, Get, Post, Put, Delete, Body, Param, Query, HttpException, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/jwt-auth.guard';
import { ScreenGuard } from '../../common/screen.guard';
import { RequireScreen } from '../../common/require-screen.decorator';
import { ProfitPeriodsService } from './profit-periods.service';

@Controller('api/profit-periods')
@UseGuards(JwtAuthGuard, ScreenGuard)
@RequireScreen('/dashboard/profit-distribution')
export class ProfitPeriodsController {
  constructor(private svc: ProfitPeriodsService) {}

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

  @Get(':id/calculate')
  async calculate(@Param('id') id: string) {
    const period = await this.svc.findOne(id);
    if (!period) return { error: 'Not found' };
    return this.svc.calculate(period);
  }

  // القراءة من الشيت الموحّد — بديلٌ لمسار إكسل درايف بالشكل نفسه
  @Post('fetch-sheet')
  async fetchSheet(@Body() body: { date_from: string; date_to: string }) {
    if (!body?.date_from || !body?.date_to) {
      throw new HttpException('الفترة الزمنية مطلوبة', 400);
    }
    try {
      return await this.svc.fetchFromUnifiedSheet(body.date_from, body.date_to);
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
