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

  // يتحقّق من وجود المستخدم وفعّاليته لحظياً — يرفض المحذوف/المعطّل ويعيد أحدث دور/بيانات
  async validate(payload: any) {
    const user = payload?.sub ? await this.userRepo.findOne({ where: { id: payload.sub } }) : null;
    if (!user || (user as any).is_active === false) {
      throw new UnauthorizedException('الحساب غير صالح أو معطّل');
    }
    return { id: user.id, email: user.email, role: user.role, full_name: user.full_name };
  }
}
