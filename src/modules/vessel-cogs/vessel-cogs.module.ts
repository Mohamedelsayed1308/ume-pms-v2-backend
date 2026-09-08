import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CommonAuthzModule } from '../../common/common-authz.module';
import { VesselCogsEntry } from './vessel-cogs.entity';
import { VesselCogsService } from './vessel-cogs.service';
import { VesselCogsController } from './vessel-cogs.controller';

/**
 * مصاريف المركب من دفتر الشركة — جدولٌ جديد، هجرته في `docs/vessel-cogs-up.sql`.
 * `CommonAuthzModule` لأنّ القراءة تُفحص بشاشة التقارير عبر `ScreenGuard`.
 */
@Module({
  imports: [CommonAuthzModule, TypeOrmModule.forFeature([VesselCogsEntry])],
  providers: [VesselCogsService],
  controllers: [VesselCogsController],
})
export class VesselCogsModule {}
