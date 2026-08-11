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

  async createUser(data: { email: string; password: string; full_name: string; role?: string }) {
    const exists = await this.userRepo.findOne({ where: { email: data.email } });
    if (exists) throw new UnauthorizedException('Email already exists');
    const hash = await bcrypt.hash(data.password, 10);
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
