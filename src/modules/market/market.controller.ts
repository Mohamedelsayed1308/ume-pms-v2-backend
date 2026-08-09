import { Controller, Get, Post, Put, Delete, Body, Param, Query, Request, UseGuards, UseInterceptors, UploadedFile, BadRequestException, ForbiddenException } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { JwtAuthGuard } from '../../common/jwt-auth.guard';
import { ScreenGuard } from '../../common/screen.guard';
import { RequireScreen } from '../../common/require-screen.decorator';
import { MarketService } from './market.service';
import { MarketImportService } from './market-import.service';
import { AgencyService } from './agency.service';
import { MarketReportService } from './market-report.service';

// حدّ معدّل بسيط في الذاكرة لإنشاء التقارير (لكل مستخدم)
const rl = new Map<string, number[]>();
function rateLimit(userId: string, max = 6, windowMs = 60000) {
  const now = Date.now(); const arr = (rl.get(userId) || []).filter((t) => now - t < windowMs);
  if (arr.length >= max) throw new ForbiddenException('طلبات كثيرة — انتظر قليلاً قبل إنشاء تقرير آخر');
  arr.push(now); rl.set(userId, arr);
}

function parseYM(s: string): { y: number; m: number } {
  const [y, m] = (s || '').split('-').map(Number);
  if (!y || !m || m < 1 || m > 12) throw new BadRequestException(`فترة غير صالحة: ${s} (استخدم YYYY-MM)`);
  return { y, m };
}
// الاستيراد وتعديلات الوكالة للأدمن فقط (بالإضافة لحارس شاشة السوق)
function ensureAdmin(req: any) { if (req.user?.role !== 'admin') throw new ForbiddenException('صلاحيات الأدمن مطلوبة'); }

@Controller('api/market')
@UseGuards(JwtAuthGuard, ScreenGuard)
@RequireScreen('/dashboard/market')
export class MarketController {
  constructor(
    private svc: MarketService,
    private importSvc: MarketImportService,
    private agencySvc: AgencyService,
    private reportSvc: MarketReportService,
  ) {}

  // ── تقرير الإدارة بالذكاء الاصطناعي ──
  @Get('report/status') reportStatus() { return { enabled: this.reportSvc.aiEnabled() }; }

  @Post('report')
  report(@Body() body: { from: string; to: string; agencies?: string[]; ship?: string; focus?: string; level?: 'executive' | 'detailed'; includeScenarios?: boolean; truckUpliftPct?: number; includeComparison?: boolean }, @Request() req: any) {
    rateLimit(req.user?.id || 'anon');
    const a = parseYM(body.from), b = parseYM(body.to);
    return this.reportSvc.generate(
      { fromY: a.y, fromM: a.m, toY: b.y, toM: b.m, agencies: body.agencies, ship: body.ship, focus: body.focus },
      { level: body.level, includeScenarios: body.includeScenarios, truckUpliftPct: body.truckUpliftPct, includeComparison: body.includeComparison },
      { id: req.user?.id, full_name: req.user?.full_name },
    );
  }

  @Get('reports') reportsList() { return this.reportSvc.list(); }
  @Get('reports/:id') reportGet(@Param('id') id: string) { return this.reportSvc.get(id); }
  @Delete('reports/:id') reportDelete(@Param('id') id: string, @Request() req: any) { return this.reportSvc.remove(id, req.user?.role === 'admin'); }

  @Get('analysis')
  analysis(@Query('from') from: string, @Query('to') to: string, @Query('agencies') agencies?: string, @Query('ship') ship?: string, @Query('focus') focus?: string) {
    const a = parseYM(from), b = parseYM(to);
    return this.svc.analysis({ fromY: a.y, fromM: a.m, toY: b.y, toM: b.m, agencies: agencies ? agencies.split(',').filter(Boolean) : undefined, ship: ship || undefined, focus });
  }

  // المقارنة السنوية: الفترة المختارة مقابل نفس الأشهر من العام السابق (إزاحة 12 شهراً)
  @Get('comparison')
  comparison(@Query('from') from: string, @Query('to') to: string, @Query('agencies') agencies?: string, @Query('ship') ship?: string, @Query('focus') focus?: string) {
    const a = parseYM(from), b = parseYM(to);
    return this.svc.yearComparison({ fromY: a.y, fromM: a.m, toY: b.y, toM: b.m, agencies: agencies ? agencies.split(',').filter(Boolean) : undefined, ship: ship || undefined, focus });
  }

  @Post('import/preview')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } }))
  preview(@UploadedFile() file: Express.Multer.File, @Request() req: any) {
    ensureAdmin(req);
    if (!file?.buffer) throw new BadRequestException('لم يصل ملف');
    return this.importSvc.preview(file.buffer);
  }

  @Post('import')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } }))
  commit(@UploadedFile() file: Express.Multer.File, @Request() req: any) {
    ensureAdmin(req);
    if (!file?.buffer) throw new BadRequestException('لم يصل ملف');
    return this.importSvc.commit(file.buffer, file.originalname, { id: req.user?.id, full_name: req.user?.full_name });
  }

  @Get('import-logs') importLogs(@Request() req: any) { ensureAdmin(req); return this.importSvc.logs(); }

  // ── إدارة تاريخ الوكالة (قراءة: شاشة السوق · تعديل: أدمن) ──
  @Get('agency-history') agencyList() { return this.agencySvc.list(); }
  @Post('agency-history') agencyCreate(@Body() body: any, @Request() req: any) { ensureAdmin(req); return this.agencySvc.upsert(body); }
  @Put('agency-history/:id') agencyUpdate(@Param('id') id: string, @Body() body: any, @Request() req: any) { ensureAdmin(req); return this.agencySvc.upsert({ ...body, id }); }
  @Post('agency-history/change') agencyChange(@Body() body: { ship_key: string; agency_key: string; agency_name_ar: string; from_date: string; ship_name_ar?: string }, @Request() req: any) {
    ensureAdmin(req);
    return this.agencySvc.changeAgency(body.ship_key, body.agency_key, body.agency_name_ar, body.from_date, body.ship_name_ar);
  }
  @Delete('agency-history/:id') agencyDelete(@Param('id') id: string, @Request() req: any) { ensureAdmin(req); return this.agencySvc.remove(id); }
}
