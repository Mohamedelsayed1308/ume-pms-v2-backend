import { Controller, Post, Body, Request, UseGuards, ForbiddenException } from '@nestjs/common';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { R3aRunnerService } from './r3a-runner.service';

// مُشغِّل الهجرة المحكوم — المسار الشرعي الوحيد لكتابة حقول التحكّم المالي.
// أدمن فقط. يُزال من الشيفرة فور اكتمال R3A وتحققه.
@Controller('api/admin/r3a')
@UseGuards(JwtAuthGuard)
export class R3aRunnerController {
  constructor(private readonly svc: R3aRunnerService) {}

  private ensureAdmin(req: any) {
    if (req.user?.role !== 'admin') throw new ForbiddenException('صلاحيات الأدمن مطلوبة');
  }

  /** dryRun=true (الافتراضي) ينفّذ كل شيء ثم يتراجع — لا يكتب شيئاً. */
  @Post('run')
  run(@Body() body: any, @Request() req: any) {
    this.ensureAdmin(req);
    return this.svc.run(body?.dryRun !== false);
  }

  @Post('rollback')
  rollback(@Request() req: any) {
    this.ensureAdmin(req);
    return this.svc.rollback();
  }
}
