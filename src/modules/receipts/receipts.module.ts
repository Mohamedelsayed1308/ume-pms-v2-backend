import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CommonAuthzModule } from '../../common/common-authz.module';
import { GoodsServiceReceipt } from './goods-service-receipt.entity';
import { ReceiptsService } from './receipts.service';
import { ReceiptsController } from './receipts.controller';

// CommonAuthzModule ليست @Global — فكل وحدة تستعمل ScreenGuard تستوردها صراحةً.
// إغفالها هنا أسقط الإنتاج عند الإقلاع، لأن الحارس لم يجد ScreenAuthzService.
@Module({
  imports: [CommonAuthzModule, TypeOrmModule.forFeature([GoodsServiceReceipt])],
  controllers: [ReceiptsController],
  providers: [ReceiptsService],
  exports: [ReceiptsService],
})
export class ReceiptsModule {}
