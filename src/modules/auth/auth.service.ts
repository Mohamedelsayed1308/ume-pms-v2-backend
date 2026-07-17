import { Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { User } from './user.entity';

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

    const token = this.jwt.sign({ sub: user.id, email: user.email, role: user.role });
    return {
      access_token: token,
      user: { id: user.id, email: user.email, full_name: user.full_name, role: user.role },
    };
  }

  async createUser(data: { email: string; password: string; full_name: string; role?: string }) {
    const exists = await this.userRepo.findOne({ where: { email: data.email } });
    if (exists) throw new UnauthorizedException('Email already exists');
    const hash = await bcrypt.hash(data.password, 10);
    const user = await this.userRepo.save({
      email: data.email,
      password: hash,
      full_name: data.full_name,
      role: data.role || 'user',
    });
    return { id: user.id, email: user.email, full_name: user.full_name, role: user.role };
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
