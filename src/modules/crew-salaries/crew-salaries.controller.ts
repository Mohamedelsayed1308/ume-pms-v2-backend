import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Put, Query, Request, Res, UploadedFile, UseGuards, UseInterceptors, BadRequestException } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import type { Response } from 'express';
import { JwtAuthGuard } from '../../common/jwt-auth.guard';
import { CrewSalariesAccessGuard } from './crew-salary.access';
import { CrewSalariesService, type Actor } from './crew-salaries.service';

/**
 * مرتّبات أطقم السفن — `api/crew-salaries`.
 * كلّ المسارات خلف مفتاح التفعيل (`CrewSalariesAccessGuard`): مغلقةٌ إلّا لصاحب صلاحية الاعتماد
 * حتّى تُفتح، ثمّ لمن مُنح الشاشة صراحةً — ولا يكفي دور الأدمن. والاعتماد (الإصدارات والحسابات
 * والتفويضات) لصاحب الصلاحية المعيَّن وحده — يُفحص في الخدمة بمعرّفٍ ثابت لا بدور.
 */
const upload = FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: 30 * 1024 * 1024, files: 1 } });
const actor = (req: any): Actor => ({ id: req?.user?.id, email: req?.user?.email, full_name: req?.user?.full_name, role: req?.user?.role });

function sendXlsx(res: Response, buffer: Buffer, filename: string) {
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename.replace(/[^A-Za-z0-9._-]/g, '_')}"`);
  res.setHeader('Cache-Control', 'no-store');
  // الواجهة على أصلٍ آخر — تقرأ اسم الملفّ وعلامة إعادة التنزيل
  res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition, X-Redownload, X-Historical, X-Pending-Decisions');
  res.send(buffer);
}

@Controller('api/crew-salaries')
@UseGuards(JwtAuthGuard, CrewSalariesAccessGuard)
export class CrewSalariesController {
  constructor(private readonly svc: CrewSalariesService) {}

  @Get('permissions')
  permissions(@Request() req: any) { return this.svc.permissions(actor(req)); }

  @Get('cycles')
  list() { return this.svc.listCycles(); }

  @Get('cycles/:id')
  view(@Param('id', ParseUUIDPipe) id: string, @Request() req: any) { return this.svc.view(id, actor(req)); }

  @Post('import')
  @UseInterceptors(upload)
  import(@UploadedFile() file: Express.Multer.File, @Body() b: any, @Request() req: any) {
    if (!file) throw new BadRequestException('لم يصل ملفّ');
    // اسم الملفّ يصل من multer بترميز latin1 — يُعاد إلى UTF-8
    const name = Buffer.from(file.originalname || 'file', 'latin1').toString('utf8');
    return this.svc.importFile(file.buffer, name, actor(req), { replaces: b?.replaces || undefined, reason: b?.reason || undefined });
  }

  @Post('files/:id/assign')
  assign(@Param('id', ParseUUIDPipe) id: string, @Body() b: any, @Request() req: any) {
    return this.svc.assignFile(id, b?.vessel, b?.month, b?.reason, actor(req));
  }

  @Get('files/:id/content')
  async content(@Param('id', ParseUUIDPipe) id: string, @Request() req: any, @Res() res: Response) {
    const f = await this.svc.fileContent(id, actor(req));
    // تنزيلٌ لا عرض — لا يُفتح محتوى نشطٌ في المتصفّح
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(f.name)}`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
    res.send(f.buffer);
  }

  @Post('cycles/:id/decisions')
  decide(@Param('id', ParseUUIDPipe) id: string, @Body() b: any, @Request() req: any) { return this.svc.decide(id, b, actor(req)); }

  @Delete('cycles/:id/decisions/:did')
  removeManual(@Param('id', ParseUUIDPipe) id: string, @Param('did', ParseUUIDPipe) did: string, @Query('reason') reason: string, @Request() req: any) {
    return this.svc.removeManual(id, did, reason, actor(req));
  }

  @Post('links')
  link(@Body() b: any, @Request() req: any) { return this.svc.confirmLink(b?.name, b?.crew_id, b?.reason, b?.cycle_id || null, actor(req)); }

  @Delete('links/:id')
  unlink(@Param('id', ParseUUIDPipe) id: string, @Query('reason') reason: string, @Query('cycle_id') cycleId: string, @Request() req: any) {
    return this.svc.revokeLink(id, reason, cycleId || null, actor(req));
  }

  @Post('cycles/:id/bank-accounts/sync')
  sync(@Param('id', ParseUUIDPipe) id: string, @Request() req: any) { return this.svc.syncBankAccounts(id, actor(req)); }

  @Post('bank-accounts')
  addBank(@Body() b: any, @Request() req: any) { return this.svc.addBankAccount(b, actor(req), b?.cycle_id || null); }

  @Post('bank-accounts/:id/review')
  reviewBank(@Param('id', ParseUUIDPipe) id: string, @Body() b: any, @Request() req: any) { return this.svc.reviewBankAccount(id, b, actor(req), b?.cycle_id || null); }

  @Post('authorizations')
  @UseInterceptors(upload)
  createAuth(@UploadedFile() file: Express.Multer.File, @Body() b: any, @Request() req: any) {
    const doc = file ? { buffer: file.buffer, originalname: Buffer.from(file.originalname || 'doc', 'latin1').toString('utf8') } : undefined;
    return this.svc.createAuthorization(b, doc, actor(req), b?.cycle_id || null);
  }

  @Post('authorizations/:id/review')
  reviewAuth(@Param('id', ParseUUIDPipe) id: string, @Body() b: any, @Request() req: any) { return this.svc.reviewAuthorization(id, b, actor(req), b?.cycle_id || null); }

  @Put('fx')
  setFx(@Body() b: any, @Request() req: any) { return this.svc.setFx(b?.month, b?.currency, String(b?.usd_per_unit ?? ''), b?.reason, actor(req)); }

  @Post('cycles/:id/submit')
  submit(@Param('id', ParseUUIDPipe) id: string, @Body() b: any, @Request() req: any) {
    const keys = Array.isArray(b?.keys) ? b.keys.map(String).slice(0, 500) : undefined;
    return this.svc.submit(id, b?.reason, actor(req), keys);
  }

  @Post('versions/:id/approve')
  approve(@Param('id', ParseUUIDPipe) id: string, @Body() b: any, @Request() req: any) { return this.svc.approve(id, b?.reason, actor(req)); }

  @Post('versions/:id/reject')
  reject(@Param('id', ParseUUIDPipe) id: string, @Body() b: any, @Request() req: any) { return this.svc.reject(id, b?.reason, actor(req)); }

  @Get('cycles/:id/export/review')
  async exportReview(@Param('id', ParseUUIDPipe) id: string, @Request() req: any, @Res() res: Response) {
    const x = await this.svc.exportReview(id, actor(req));
    sendXlsx(res, x.buffer, x.filename);
  }

  @Post('cycles/:id/export/payments')
  async exportPayments(@Param('id', ParseUUIDPipe) id: string, @Body() b: any, @Request() req: any, @Res() res: Response) {
    const x = await this.svc.exportPayments(id, b?.currency, actor(req), b?.version_id || undefined);
    res.setHeader('X-Redownload', x.redownload ? '1' : '0');
    res.setHeader('X-Historical', x.historical ? '1' : '0');
    res.setHeader('X-Pending-Decisions', String(x.pending || 0));
    sendXlsx(res, x.buffer, x.filename);
  }

  /** دفعةٌ بعينها كما خرجت أوّل مرّة — حرفيّاً. */
  @Get('exports/:id/file')
  async exportFile(@Param('id', ParseUUIDPipe) id: string, @Request() req: any, @Res() res: Response) {
    const x = await this.svc.downloadExport(id, actor(req));
    res.setHeader('X-Redownload', '1');
    res.setHeader('X-Historical', x.historical ? '1' : '0');
    sendXlsx(res, x.buffer, x.filename);
  }
}
