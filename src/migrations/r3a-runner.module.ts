import { Module } from '@nestjs/common';
import { R3aRunnerService } from './r3a-runner.service';
import { R3aRunnerController } from './r3a-runner.controller';

@Module({
  controllers: [R3aRunnerController],
  providers: [R3aRunnerService],
})
export class R3aRunnerModule {}
