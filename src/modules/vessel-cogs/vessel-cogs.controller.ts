import { Controller, Get, Post, Delete, Body, Param, Request, UseGuards, ForbiddenException } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/jwt-auth.guard';
import { ScreenGuard } from '../../common/screen.guard';
import { RequireScreen } from '../../common/require-screen.decorator';
import { VesselCogsService } from './vessel-cogs.service';

/**
 * القراءة لمن يملك شاشة التقارير (فالكارت يقرأ منها). والكتابة للأدمن وحده:
 * الاستيراد يغيّر رقم ربح المركب دفعةً واحدة، فحدُّه **دورٌ لا منحة**.
 */
function ensureAdmin(req: any) {
  if (req?.user?.role !== 'admin') throw new ForbiddenException('صلاحيات الأدمن مطلوبة');
}

@Controller('api/vessel-cogs')
@UseGuards(JwtAuthGuard, ScreenGuard)
@RequireScreen('/dashboard/reports')
export class VesselCogsController {
  constructor(private svc: VesselCogsService) {}

  @Get('by-vessel/:vessel')
  byVessel(@Param('vessel') vessel: string) {
    return this.svc.listByVessel(vessel);
  }

  /** الخطّة — تُعرض ولا تكتب. */
  @Post('import/plan')
  plan(@Request() req: any, @Body() b: any) {
    ensureAdmin(req);
    return this.svc.plan(String(b?.vessel || ''), b?.rows, String(b?.batch_code || ''));
  }

  /** الكتابة — الجديد وحده، بعد أن عُرضت الخطّة. */
  @Post('import/commit')
  commit(@Request() req: any, @Body() b: any) {
    ensureAdmin(req);
    return this.svc.commit(String(b?.vessel || ''), b?.rows, String(b?.batch_code || ''), req.user?.id || '');
  }

  /** إعادة تطبيق خريطة التصنيف على المستورَد — بعد تغييرٍ في القواعد. */
  @Post('reapply-rules')
  reapply(@Request() req: any, @Body() b: any) {
    ensureAdmin(req);
    return this.svc.reapplyRules(String(b?.vessel || ''));
  }

  @Post('entry')
  addEntry(@Request() req: any, @Body() b: any) {
    ensureAdmin(req);
    return this.svc.addManual(b, req.user?.id || '');
  }

  @Delete(':id')
  remove(@Request() req: any, @Param('id') id: string) {
    ensureAdmin(req);
    return this.svc.remove(id);
  }
}
