import { Injectable, UnauthorizedException, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { User } from './user.entity';

// قائمة سماح صريحة للأدوار. أي قيمة أخرى (فارغة/غير معروفة/غير نصية) تؤول إلى 'user'.
// لا نمرّر قيمة غير متحقَّق منها لقاعدة البيانات ولا نعتمد على افتراضي العمود.
export const ROLES = ['admin', 'user'] as const;
export type Role = (typeof ROLES)[number];
export function normalizeRole(role: unknown): Role {
  return typeof role === 'string' && (ROLES as readonly string[]).includes(role) ? (role as Role) : 'user';
}

/*
 * الحدّ الأدنى لكلمة المرور، والقيمة التي تُخزَّن.
 *
 * لم يكن ثمّة حدٌّ أصلاً: `createUser` كانت تقبل حرفاً واحداً. والحدّ هنا في
 * الخدمة لا في الواجهة، فمسار الإنشاء ومسار التغيير كلاهما يمرّ به.
 *
 * ── ولماذا تُقصّ المسافات الطرفيّة ──
 * كانت الدالّة تفحص `pw.trim()` وتُعيد `pw` كما هو، فتُخزَّن التجزئة بمسافةٍ
 * لاصقةٍ لا يراها أحد. ثمّ يكتبها صاحبها بلا مسافةٍ عند الدخول فتُرفض، ولا
 * رسالة تدلّ عليه. والمسافة الطرفيّة في كلمةٍ يكتبها الأدمن لغيره خطأُ نسخٍ
 * لا نيّة — فتُقصّ **قبل الفحص والتخزين معاً**، فيتطابق ما يُقاس وما يُحفظ.
 */
export const MIN_PASSWORD_LEN = 8;
export function assertPassword(v: unknown): string {
  const pw = (typeof v === 'string' ? v : '').trim();
  if (pw.length < MIN_PASSWORD_LEN) {
    throw new BadRequestException(`كلمة المرور لا تقلّ عن ${MIN_PASSWORD_LEN} أحرف`);
  }
  return pw;
}

// قائمة شاشات صريحة صالحة = مصفوفة غير فارغة من مسارات لوحة التحكم
export function isValidScreens(v: unknown): v is string[] {
  return Array.isArray(v) && v.length > 0 && v.every((s) => typeof s === 'string' && s.startsWith('/dashboard'));
}

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User) private userRepo: Repository<User>,
    private jwt: JwtService,
  ) {}

  async login(email: string, password: string) {
    const user = await this.userRepo.findOne({ where: { email, is_active: true } });
    if (!user) throw new UnauthorizedException('Invalid credentials');

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) throw new UnauthorizedException('Invalid credentials');

    const token = this.jwt.sign({ sub: user.id, email: user.email, role: user.role, full_name: user.full_name });
    return {
      access_token: token,
      user: { id: user.id, email: user.email, full_name: user.full_name, role: user.role, allowed_screens: user.allowed_screens || null },
    };
  }

  listUsers() {
    return this.userRepo.find({
      select: { id: true, email: true, full_name: true, role: true, is_active: true, allowed_screens: true, created_at: true },
      order: { created_at: 'ASC' },
    });
  }

  async setPermissions(id: string, allowed_screens: string[]) {
    await this.userRepo.update(id, { allowed_screens });
    return this.userRepo.findOne({
      where: { id },
      select: { id: true, email: true, full_name: true, role: true, is_active: true, allowed_screens: true },
    });
  }

  async setActive(id: string, is_active: boolean) {
    await this.userRepo.update(id, { is_active });
    return { id, is_active };
  }

  /*
   * تعيين كلمة مرورٍ لمستخدم — للأدمن وحده (يُفرض في المتحكّم).
   *
   * ولا يُعاد في الجواب شيءٌ من كلمة المرور ولا تجزئتها، ولا تُسجَّل في أيّ سجلّ.
   *
   * ── حدٌّ معروف ──
   * الجلسات القائمة لا تُبطَل: الـ JWT لا يحمل رقم إصدارٍ لكلمة المرور، فمن كان
   * داخلاً يبقى حتّى تنتهي مدّة رمزه. ولإبطالها فوراً أوقِف الحساب ثمّ فعّله.
   */
  async setPassword(id: string, password: unknown) {
    const pw = assertPassword(password);
    const user = await this.userRepo.findOne({ where: { id } });
    if (!user) throw new NotFoundException('المستخدم غير موجود');
    await this.userRepo.update(id, { password: await bcrypt.hash(pw, 10) });
    return { id, email: user.email, full_name: user.full_name, changed: true };
  }

  async createUser(data: { email: string; password: string; full_name: string; role?: string }) {
    const exists = await this.userRepo.findOne({ where: { email: data.email } });
    if (exists) throw new UnauthorizedException('Email already exists');
    const hash = await bcrypt.hash(assertPassword(data.password), 10);
    const user = await this.userRepo.save({
      email: data.email,
      password: hash,
      full_name: data.full_name,
      role: normalizeRole(data.role), // قائمة سماح — لا تصعيد صلاحيات عبر قيمة غير متوقَّعة
    });
    return { id: user.id, email: user.email, full_name: user.full_name, role: user.role };
  }

  // تغيير الدور — للأدمن فقط (يُفرض في المتحكّم).
  // قاعدة السلامة: تحويل admin → user يتطلب allowed_screens صريحة وصالحة،
  // وإلا أصبح المستخدم محجوباً بالكامل بعد سياسة deny-by-default (R2.3).
  async setRole(id: string, role: unknown, allowed_screens?: unknown) {
    const next = normalizeRole(role);
    const user = await this.userRepo.findOne({ where: { id } });
    if (!user) throw new NotFoundException('المستخدم غير موجود');

    if (user.role === 'admin' && next === 'user') {
      const provided = isValidScreens(allowed_screens);
      const existing = isValidScreens((user as any).allowed_screens);
      if (!provided && !existing) {
        throw new BadRequestException(
          'تحويل أدمن إلى مستخدم يتطلب تحديد allowed_screens صريحة في نفس الطلب. ' +
          'لن تُمنح قائمة افتراضية تلقائياً — يجب على المسؤول تحديد الصلاحيات صراحةً.',
        );
      }
      if (provided) await this.userRepo.update(id, { allowed_screens: allowed_screens as string[] });
    }

    await this.userRepo.update(id, { role: next });
    return this.userRepo.findOne({
      where: { id },
      select: { id: true, email: true, full_name: true, role: true, is_active: true, allowed_screens: true },
    });
  }

  async seedAdmin() {
    const exists = await this.userRepo.findOne({ where: { email: 'admin@ume.com' } });
    if (!exists) {
      const hash = await bcrypt.hash('Admin@123', 10);
      await this.userRepo.save({
        email: 'admin@ume.com',
        password: hash,
        full_name: 'System Admin',
        role: 'admin',
      });
    }
  }
}
