import { Controller, Post, Put, Body, Get, Param, UseGuards, Request, ForbiddenException, NotFoundException } from '@nestjs/common';
import { ThrottlerGuard, Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from '../../common/jwt-auth.guard';
import { LOGIN_THROTTLER, LOGIN_LIMIT, LOGIN_TTL_MS } from '../../common/rate-limit';

function ensureAdmin(req: any) {
  if (req.user?.role !== 'admin') throw new ForbiddenException('صلاحيات الأدمن مطلوبة');
}

// fail-closed: يُعتبر إنتاجاً ما لم تُعلَن البيئة صراحةً كتطوير/اختبار.
// (NODE_ENV غير مضبوط ⇒ إنتاج ⇒ نقاط التهيئة معطّلة)
function isNonProduction(): boolean {
  return ['development', 'test', 'local'].includes((process.env.NODE_ENV || '').trim().toLowerCase());
}

@Controller('api/auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  /*
   * الموجّه الوحيد المحدود بمعدّل في هذه المرحلة.
   *
   * وكان مفتوحاً بلا حدّ محاولات — تخمينٌ آليٌّ بلا مقاومة. والحدّ على الموجّه
   * وحده لا على النظام كلّه: خمس محاولات في الدقيقة لكلّ عنوان، فمن أخطأ
   * كلمته مرّتين لا يشعر بشيء.
   *
   * والردّ عند التجاوز `429` برسالةٍ عامّة — لا تقول أَوُجد البريد أم لا، ولا
   * أيّ الحقلين كان خطأً. والخدمة أصلاً تردّ «Invalid credentials» في الحالتين،
   * فلا يُستدلّ على وجود حسابٍ من فرقٍ في الجواب.
   */
  @Post('login')
  @UseGuards(ThrottlerGuard)
  @Throttle({ [LOGIN_THROTTLER]: { limit: LOGIN_LIMIT, ttl: LOGIN_TTL_MS } })
  login(@Body() body: { email: string; password: string }) {
    return this.authService.login(body.email, body.password);
  }

  // تهيئة أدمن افتراضي — أداة تطوير فقط.
  // الإنتاج: غير موجودة (404). خارج الإنتاج: تتطلب JWT + دور admin.
  @Get('seed')
  @UseGuards(JwtAuthGuard)
  seed(@Request() req: any) {
    if (!isNonProduction()) throw new NotFoundException();
    ensureAdmin(req);
    return this.authService.seedAdmin();
  }

  @Post('users')
  @UseGuards(JwtAuthGuard)
  createUser(@Body() body: { email: string; password: string; full_name: string; role?: string }, @Request() req: any) {
    ensureAdmin(req);
    return this.authService.createUser(body);
  }

  @Get('users')
  @UseGuards(JwtAuthGuard)
  listUsers(@Request() req: any) {
    ensureAdmin(req);
    return this.authService.listUsers();
  }

  @Put('users/:id/permissions')
  @UseGuards(JwtAuthGuard)
  setPermissions(@Param('id') id: string, @Body() body: { allowed_screens: string[] }, @Request() req: any) {
    ensureAdmin(req);
    return this.authService.setPermissions(id, body.allowed_screens || []);
  }

  @Put('users/:id/active')
  @UseGuards(JwtAuthGuard)
  setActive(@Param('id') id: string, @Body() body: { is_active: boolean }, @Request() req: any) {
    ensureAdmin(req);
    return this.authService.setActive(id, body.is_active);
  }

  // تغيير الدور — أدمن فقط خادمياً (لا يُعتمد على إخفاء زر في الواجهة).
  // تحويل admin → user يتطلب allowed_screens صريحة في نفس الطلب (يُفرض في الخدمة).
  @Put('users/:id/role')
  @UseGuards(JwtAuthGuard)
  setRole(@Param('id') id: string, @Body() body: { role: string; allowed_screens?: string[] }, @Request() req: any) {
    ensureAdmin(req);
    return this.authService.setRole(id, body?.role, body?.allowed_screens);
  }
}
