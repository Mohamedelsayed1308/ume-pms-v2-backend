import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { ScreenAuthzService } from '../../common/screen-authz.service';
import { isApprover } from './crew-salary.approver';
import { SCREEN } from './crew-salaries.service';

/**
 * مفتاح تفعيل مرتّبات الأطقم — على **كلّ** مسارات الوحدة (العرض والاستيراد وتنزيل الملفّات
 * والحسابات والتصدير والاعتماد)، لا على الواجهة وحدها.
 *
 * `CREW_SALARIES_ACCESS`:
 *   - غائبٌ أو أيّ قيمةٍ غير `listed` ⇒ **مغلق**: صاحب صلاحية الاعتماد وحده (للتجربة قبل الإتاحة).
 *   - `listed` ⇒ صاحب صلاحية الاعتماد، ومن مُنح الشاشة **صراحةً** في قائمته.
 *
 * وفي الحالتين لا يكفي دور الأدمن: تجاوز الأدمن لقوائم الشاشات (قاعدة المنظومة العامّة) لا
 * يسري على هذه الميزة، فبياناتها رواتبُ وحساباتٌ بنكيّة. والحساب المعطَّل مرفوضٌ دائماً.
 */
export type CrewAccessMode = 'closed' | 'listed';

export function crewAccessMode(env: NodeJS.ProcessEnv = process.env): CrewAccessMode {
  return (env.CREW_SALARIES_ACCESS || '').trim().toLowerCase() === 'listed' ? 'listed' : 'closed';
}

@Injectable()
export class CrewSalariesAccessGuard implements CanActivate {
  constructor(private readonly authz: ScreenAuthzService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const userId: string | undefined = ctx.switchToHttp().getRequest().user?.id;
    if (!userId || !(await this.authz.isActive(userId))) throw new ForbiddenException('لا تملك صلاحية الوصول لهذه الشاشة');
    if (isApprover(userId)) return true;
    if (crewAccessMode() === 'closed') {
      throw new ForbiddenException('مرتّبات الأطقم مغلقةٌ بعد — متاحةٌ لصاحب صلاحية الاعتماد وحده حتّى تُفتح');
    }
    if (await this.authz.isListed(userId, SCREEN)) return true;
    throw new ForbiddenException('لا تملك صلاحية شاشة المرتّبات — تُمنح صراحةً لكلّ مستخدم، ولا يكفي دور الأدمن');
  }
}
