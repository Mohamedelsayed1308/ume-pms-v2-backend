import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from './user.entity';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    @InjectRepository(User) private userRepo: Repository<User>,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: config.get('JWT_SECRET') as string,
    });
  }

  /*
   * يتحقّق من وجود المستخدم وفعّاليته لحظياً — يرفض المحذوف/المعطّل ويعيد أحدث دور/بيانات.
   * ثمّ يتحقّق أنّ الرمز يحمل رقم الجلسة السارية.
   *
   * الصفّ محمَّلٌ أصلاً لفحص `is_active`، فالفحص الثاني مقارنةُ حقلٍ بلا استعلامٍ جديد.
   *
   * و`session_id` الفارغ يعني «لا جلسة مثبَّتة» فتُقبل الرموز القائمة — وهي حال
   * الحسابات بعد الهجرة مباشرةً. والتثبيت يبدأ من أوّل دخول.
   *
   * ولا يُكتب هنا حدثٌ ولا إشعار: الحادثة سُجّلت مرّةً لحظةَ الدخول الجديد،
   * وهذا الطلب أثرٌ من جهازٍ أُبطل رمزه — فيُرَدّ بصمتٍ مهما تكرّر.
   */
  async validate(payload: any) {
    const user = payload?.sub ? await this.userRepo.findOne({ where: { id: payload.sub } }) : null;
    if (!user || (user as any).is_active === false) {
      throw new UnauthorizedException('الحساب غير صالح أو معطّل');
    }
    if (user.session_id && payload?.sid !== user.session_id) {
      throw new UnauthorizedException({
        code: 'SESSION_REVOKED',
        message: 'تم تسجيل خروجك لأن الحساب تم تسجيل الدخول إليه من جهاز آخر.',
      });
    }
    return { id: user.id, email: user.email, role: user.role, full_name: user.full_name };
  }
}
