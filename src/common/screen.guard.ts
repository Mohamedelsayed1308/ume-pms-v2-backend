import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { REQUIRE_SCREEN } from './require-screen.decorator';
import { ScreenAuthzService } from './screen-authz.service';

// حارس تفويض مركزي على مستوى الشاشة (يُستخدم بعد JwtAuthGuard).
// يسمح إذا كان لدى المستخدم أيّاً من الشاشات المطلوبة (أو لا شاشة مطلوبة).
@Injectable()
export class ScreenGuard implements CanActivate {
  constructor(private reflector: Reflector, private authz: ScreenAuthzService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const hrefs = this.reflector.getAllAndOverride<string[]>(REQUIRE_SCREEN, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!hrefs || hrefs.length === 0) return true; // لا قيد شاشة
    const req = ctx.switchToHttp().getRequest();
    const userId = req.user?.id;
    if (!(await this.authz.canAny(userId, hrefs))) {
      throw new ForbiddenException('لا تملك صلاحية الوصول لهذه الشاشة');
    }
    return true;
  }
}
