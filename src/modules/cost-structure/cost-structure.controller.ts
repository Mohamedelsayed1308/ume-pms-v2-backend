import { Controller, Get, Put, Delete, Body, Param, Request, UseGuards, ForbiddenException } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/jwt-auth.guard';
import { ScreenGuard } from '../../common/screen.guard';
import { RequireScreen } from '../../common/require-screen.decorator';
import { CostStructureService } from './cost-structure.service';

/**
 * القراءة لمن يملك شاشة التقارير (فالتقارير تقرأ منها). والكتابة للأدمن وحده:
 * تغيير رمز بندٍ ينقل مبلغه بين مجموعات الهيكل في كلّ تقارير الأسطول دفعةً واحدة.
 */
function ensureAdmin(req: any) {
  if (req?.user?.role !== 'admin') throw new ForbiddenException('صلاحيات الأدمن مطلوبة');
}

@Controller('api/cost-structure')
@UseGuards(JwtAuthGuard, ScreenGuard)
@RequireScreen('/dashboard/reports')
export class CostStructureController {
  constructor(private readonly svc: CostStructureService) {}

  @Get('codes')
  list() {
    return this.svc.list();
  }

  /** body = { code: 'A' | 'D' | 'F' } */
  @Put('codes/:key')
  set(@Request() req: any, @Param('key') key: string, @Body() b: any) {
    ensureAdmin(req);
    return this.svc.set(key, b?.code, req.user?.id || '');
  }

  @Delete('codes/:key')
  clear(@Request() req: any, @Param('key') key: string) {
    ensureAdmin(req);
    return this.svc.clear(key);
  }
}
