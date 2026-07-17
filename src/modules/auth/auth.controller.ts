import { Controller, Post, Body, Get, UseGuards } from '@nestjs/common';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from '../../common/jwt-auth.guard';

@Controller('api/auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Post('login')
  login(@Body() body: { email: string; password: string }) {
    return this.authService.login(body.email, body.password);
  }

  @Get('seed')
  seed() {
    return this.authService.seedAdmin();
  }

  @Post('users')
  @UseGuards(JwtAuthGuard)
  createUser(@Body() body: { email: string; password: string; full_name: string; role?: string }) {
    return this.authService.createUser(body);
  }
}
