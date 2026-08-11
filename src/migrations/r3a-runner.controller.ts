import { Controller, Post, Body, Request, UseGuards, ForbiddenException, NotFoundException } from '@nestjs/common';
import { JwtAuthGuard } from '../common/jwt-auth.guard';
import { R3aRunnerService } from './r3a-runner.service';

/**
 * مُشغِّل هجرة R3A — مسار تعافٍ عالي الحساسية: ينفّذ DDL ويكتب على بيانات قائمة.
 *
 * يبقى موجوداً لأنه المسار الوحيد المُختبَر لاستعادة التوسيم، لكنه **معطَّل افتراضياً**.
 * تفعيله فعل مقصود يتطلب ضبط متغيّر بيئة، ثم يُعاد إغلاقه بعد الحاجة.
 *
 * بوابتان متتاليتان:
 *   1. بوابة البيئة  → 404 (لا تكشف وجود المسار أصلاً)
 *   2. صلاحية الأدمن → 403
 */
export const R3A_RUNNER_ENV = 'R3A_RUNNER_ENABLED';

/**
 * fail-closed: القيمة الوحيدة المقبولة هي 'true' صراحةً (بلا حساسية لحالة الأحرف
 * أو المسافات). أي شيء آخر — غياب المتغيّر · فارغ · '1' · 'yes' · 'TRUE ' مع محارف
 * غريبة — يعني معطَّل. لا تُقرأ القيمة إلا كمنطق، ولا تُطبع أبداً.
 */
export function isRunnerEnabled(raw: string | undefined): boolean {
  return typeof raw === 'string' && raw.trim().toLowerCase() === 'true';
}

@Controller('api/admin/r3a')
@UseGuards(JwtAuthGuard)
export class R3aRunnerController {
  constructor(private readonly svc: R3aRunnerService) {}

  /** 404 لا 403: المسار المعطَّل يجب ألا يُقرّ بوجوده لأحد، أدمن كان أو غيره. */
  private ensureEnabled() {
    if (!isRunnerEnabled(process.env[R3A_RUNNER_ENV])) throw new NotFoundException();
  }

  private ensureAdmin(req: any) {
    if (req.user?.role !== 'admin') throw new ForbiddenException('صلاحيات الأدمن مطلوبة');
  }

  /** dryRun=true (الافتراضي) ينفّذ كل شيء ثم يتراجع — لا يكتب شيئاً. */
  @Post('run')
  run(@Body() body: any, @Request() req: any) {
    this.ensureEnabled();
    this.ensureAdmin(req);
    return this.svc.run(body?.dryRun !== false);
  }

  @Post('rollback')
  rollback(@Request() req: any) {
    this.ensureEnabled();
    this.ensureAdmin(req);
    return this.svc.rollback();
  }
}
