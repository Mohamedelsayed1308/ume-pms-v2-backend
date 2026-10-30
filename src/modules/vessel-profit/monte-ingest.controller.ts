import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { MonteIngestGuard } from './monte-ingest.guard';
import { MonteIngestService } from './monte-ingest.service';

// موجّهٌ منفصل عن `api/vessel-profit` لأنّ حارس ذاك (JWT وشاشة التقارير) على الصنف كلّه
@Controller('api/vessel-profit-ingest')
@UseGuards(MonteIngestGuard)
export class MonteIngestController {
  constructor(private svc: MonteIngestService) {}

  @Post('monte')
  @HttpCode(200)
  ingest(@Body() body: { package?: unknown; file?: unknown }) {
    return this.svc.ingest(body?.package, body?.file);
  }
}
