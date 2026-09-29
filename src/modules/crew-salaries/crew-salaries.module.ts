import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CommonAuthzModule } from '../../common/common-authz.module';
import { ExchangeRatesModule } from '../exchange-rates/exchange-rates.module';
import { CREW_SALARY_ENTITIES } from './crew-salary.entity';
import { CrewSalariesService } from './crew-salaries.service';
import { CrewSalariesController } from './crew-salaries.controller';
import { CrewSalariesAccessGuard } from './crew-salary.access';

/**
 * مرتّبات أطقم السفن — أحد عشر جدولاً جديداً، هجرتها في `docs/crew-salaries-up.sql`.
 * أسعار الصرف من `ExchangeRatesModule` القائم (لا جدول موازٍ).
 */
@Module({
  imports: [CommonAuthzModule, ExchangeRatesModule, TypeOrmModule.forFeature(CREW_SALARY_ENTITIES)],
  providers: [CrewSalariesService, CrewSalariesAccessGuard],
  controllers: [CrewSalariesController],
})
export class CrewSalariesModule {}
