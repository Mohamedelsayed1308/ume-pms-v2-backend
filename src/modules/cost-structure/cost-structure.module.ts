import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CommonAuthzModule } from '../../common/common-authz.module';
import { CostItemCode } from './cost-item-code.entity';
import { CostStructureService } from './cost-structure.service';
import { CostStructureController } from './cost-structure.controller';

/**
 * رموز هيكل التكاليف — جدولٌ جديد، هجرته في `docs/cost-structure-codes-up.sql`.
 * `CommonAuthzModule` لأنّ القراءة تُفحص بشاشة التقارير عبر `ScreenGuard`.
 */
@Module({
  imports: [CommonAuthzModule, TypeOrmModule.forFeature([CostItemCode])],
  providers: [CostStructureService],
  controllers: [CostStructureController],
})
export class CostStructureModule {}
