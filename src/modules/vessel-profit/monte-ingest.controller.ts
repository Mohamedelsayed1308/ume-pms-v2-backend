import { Body, Controller, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import { MonteIngestGuard } from './monte-ingest.guard';
import { MonteIngestService } from './monte-ingest.service';
import { MonteInputsService } from './monte-inputs.service';
import { MonteInvoicesService } from './monte-invoices.service';

// موجّهٌ منفصل عن `api/vessel-profit` لأنّ حارس ذاك (JWT وشاشة التقارير) على الصنف كلّه
@Controller('api/vessel-profit-ingest')
@UseGuards(MonteIngestGuard)
export class MonteIngestController {
  constructor(private svc: MonteIngestService, private inputs: MonteInputsService, private invoices: MonteInvoicesService) {}

  @Post('monte')
  @HttpCode(200)
  ingest(@Body() body: { package?: unknown; file?: unknown }) {
    return this.svc.ingest(body?.package, body?.file);
  }

  // سكربت مونتي يسحب مدخلات الفريق بالمفتاح نفسه قبل كلّ تحديث (قراءةٌ فقط)
  @Get('monte/inputs')
  listInputs() {
    return this.inputs.list();
  }

  // وفواتير المركب من شاشة الفواتير (أمر المالك ١ نوفمبر) — قراءةٌ فقط
  @Get('monte/invoices')
  listInvoices() {
    return this.invoices.list();
  }
}
