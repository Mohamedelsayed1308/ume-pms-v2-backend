import { Controller, Get, Post, Put, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { CurrenciesService } from './currencies.service';
import { JwtAuthGuard } from '../../common/jwt-auth.guard';

@Controller('api/currencies')
@UseGuards(JwtAuthGuard)
export class CurrenciesController {
  constructor(private svc: CurrenciesService) {}

  @Get() findAll() { return this.svc.findAll(); }
  @Get('seed') seed() { return this.svc.seed(); }
  @Get(':id') findOne(@Param('id') id: string) { return this.svc.findOne(id); }
  @Post() create(@Body() body: any) { return this.svc.create(body); }
  @Put(':id') update(@Param('id') id: string, @Body() body: any) { return this.svc.update(id, body); }
  @Delete(':id') remove(@Param('id') id: string) { return this.svc.remove(id); }
}
