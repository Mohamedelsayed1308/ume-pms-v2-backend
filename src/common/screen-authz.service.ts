import { Injectable, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../modules/auth/user.entity';

// تفويض مركزي على مستوى الشاشة (يعيد استخدام role + allowed_screens من قاعدة البيانات).
// المصدر الوحيد للحقيقة خادمياً — لا يعتمد على الفرونت. يرفض المستخدم المعطّل/المحذوف أيضاً.
@Injectable()
export class ScreenAuthzService {
  constructor(@InjectRepository(User) private userRepo: Repository<User>) {}

  async can(userId: string, href: string): Promise<boolean> {
    const user = userId ? await this.userRepo.findOne({ where: { id: userId } }) : null;
    if (!user || (user as any).is_active === false) return false; // محذوف/معطّل
    if (user.role === 'admin') return true;                        // الأدمن يتجاوز قوائم الشاشات
    // غير الأدمن: يلزم قائمة صريحة تحتوي الشاشة. الغياب = منع (deny-by-default).
    const allowed = (user as any).allowed_screens;
    if (!Array.isArray(allowed)) return false;
    return allowed.includes(href);
  }

  // يسمح إذا كان لدى المستخدم أيٌّ من الشاشات المعطاة
  async canAny(userId: string, hrefs: string[]): Promise<boolean> {
    for (const h of hrefs) if (await this.can(userId, h)) return true;
    return false;
  }

  async assert(userId: string, href: string): Promise<void> {
    if (!(await this.can(userId, href))) throw new ForbiddenException('لا تملك صلاحية الوصول لهذه البيانات');
  }

  async assertAny(userId: string, hrefs: string[]): Promise<void> {
    if (!(await this.canAny(userId, hrefs))) throw new ForbiddenException('لا تملك صلاحية الوصول لهذه البيانات');
  }
}
