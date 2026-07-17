import { Controller, Get, Post, Put, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { SuppliersService } from './suppliers.service';
import { JwtAuthGuard } from '../../common/jwt-auth.guard';

@Controller('api/suppliers')
@UseGuards(JwtAuthGuard)
export class SuppliersController {
  constructor(private svc: SuppliersService) {}

  @Get() findAll() { return this.svc.findAll(); }
  @Get(':id') findOne(@Param('id') id: string) { return this.svc.findOne(id); }
  @Get(':id/stats') getStats(@Param('id') id: string) { return this.svc.getStats(id); }
  @Post() create(@Body() body: any) { return this.svc.create(body); }
  @Put(':id') update(@Param('id') id: string, @Body() body: any) { return this.svc.update(id, body); }
  @Delete(':id') remove(@Param('id') id: string) { return this.svc.remove(id); }
}
