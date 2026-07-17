import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Vessel } from './vessel.entity';
import { VesselsController } from './vessels.controller';
import { VesselsService } from './vessels.service';

@Module({
  imports: [TypeOrmModule.forFeature([Vessel])],
  controllers: [VesselsController],
  providers: [VesselsService],
  exports: [VesselsService],
})
export class VesselsModule {}
