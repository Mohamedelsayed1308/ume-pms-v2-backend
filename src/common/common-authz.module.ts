import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../modules/auth/user.entity';
import { ScreenAuthzService } from './screen-authz.service';

// وحدة مشتركة تتيح ScreenAuthzService لأي وحدة تحتاج تفويض شاشة خادمي.
@Module({
  imports: [TypeOrmModule.forFeature([User])],
  providers: [ScreenAuthzService],
  exports: [ScreenAuthzService],
})
export class CommonAuthzModule {}
