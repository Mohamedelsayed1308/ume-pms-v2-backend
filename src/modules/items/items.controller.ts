import { Controller, Get, Post, Put, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { ItemsService } from './items.service';
import { JwtAuthGuard } from '../../common/jwt-auth.guard';
import { ScreenGuard } from '../../common/screen.guard';
import { RequireScreen } from '../../common/require-screen.decorator';

@Controller('api/items')
@UseGuards(JwtAuthGuard, ScreenGuard)
@RequireScreen('/dashboard/items', '/dashboard/invoices')
export class ItemsController {
  constructor(private svc: ItemsService) {}

  @Get() findAll() { return this.svc.findAll(); }
  @Post() create(@Body() body: any) { return this.svc.create(body); }
  @Put(':id') update(@Param('id') id: string, @Body() body: any) { return this.svc.update(id, body); }
  @Delete(':id') remove(@Param('id') id: string) { return this.svc.remove(id); }
}
