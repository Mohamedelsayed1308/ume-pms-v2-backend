import { Controller, Get, UseGuards, Request, ForbiddenException } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/jwt-auth.guard';
import { AuditService } from './audit.service';

// تفويض خادمي صارم: الدور يُقرأ من قاعدة البيانات في jwt.strategy لكل طلب،
// ولا يُعتمد إطلاقاً على أي قيمة قادمة من المتصفح.
function ensureAdmin(req: any) {
  if (req.user?.role !== 'admin') throw new ForbiddenException('صلاحيات الأدمن مطلوبة');
}

@Controller('api/audit')
@UseGuards(JwtAuthGuard)
export class AuditController {
  constructor(private svc: AuditService) {}

  // تدقيق السلامة المالية — SELECT فقط، بلا أي أثر جانبي
  @Get('financial-integrity')
  financialIntegrity(@Request() req: any) {
    ensureAdmin(req);
    return this.svc.run();
  }
}
