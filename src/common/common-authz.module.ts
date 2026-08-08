import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../modules/auth/user.entity';
import { ScreenAuthzService } from './screen-authz.service';
import { ScreenGuard } from './screen.guard';

// وحدة مشتركة تتيح ScreenAuthzService + ScreenGuard لأي وحدة تحتاج تفويض شاشة خادمي.
@Module({
  imports: [TypeOrmModule.forFeature([User])],
  providers: [ScreenAuthzService, ScreenGuard],
  exports: [ScreenAuthzService, ScreenGuard],
})
export class CommonAuthzModule {}
