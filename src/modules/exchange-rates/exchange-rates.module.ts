import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ExchangeRate } from './exchange-rate.entity';
import { ExchangeRatesService } from './exchange-rates.service';
import { ExchangeRatesController } from './exchange-rates.controller';

@Module({
  imports: [TypeOrmModule.forFeature([ExchangeRate])],
  providers: [ExchangeRatesService],
  controllers: [ExchangeRatesController],
})
export class ExchangeRatesModule {}
