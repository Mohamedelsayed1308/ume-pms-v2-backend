import { Controller, Get, Post, Put, Delete, Body, Param, Query } from '@nestjs/common';
import { ProfitPeriodsService } from './profit-periods.service';

@Controller('api/profit-periods')
export class ProfitPeriodsController {
  constructor(private svc: ProfitPeriodsService) {}

  @Get()
  findAll() { return this.svc.findAll(); }

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

  @Post('fetch-excel')
  async fetchExcel(@Body() body: { file_id: string; date_from: string; date_to: string }) {
    try {
      return await this.svc.fetchFromGoogleDrive(body.file_id, body.date_from, body.date_to);
    } catch (e: any) {
      const msg = e?.response?.data ? `HTTP ${e.response.status}` : e?.message || 'Unknown error';
      throw new (await import('@nestjs/common').then(m => m.HttpException))(
        { message: msg, detail: e?.message },
        500,
      );
    }
  }
}
