import { Controller, Get, Put, Param, Body, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/jwt-auth.guard';
import { ExchangeRatesService } from './exchange-rates.service';

@Controller('api/exchange-rates')
@UseGuards(JwtAuthGuard)
export class ExchangeRatesController {
  constructor(private readonly service: ExchangeRatesService) {}

  // كل الشهور { 'YYYY-MM': { EGP: 50, ... } }
  @Get()
  getAll() {
    return this.service.getAll();
  }

  @Get(':month')
  getMonth(@Param('month') month: string) {
    return this.service.getMonth(month);
  }

  // body = { rates: { EGP: 50, SAR: 3.75, ... } } أو الأسعار مباشرة
  @Put(':month')
  save(@Param('month') month: string, @Body() body: any) {
    const rates = body && body.rates ? body.rates : body;
    return this.service.upsert(month, rates);
  }
}
