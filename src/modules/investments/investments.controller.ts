import {
  Controller, Get, Post, Patch, Delete, Body, Param, Query, Request,
  UseGuards, ForbiddenException,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/jwt-auth.guard';
import { InvestmentsService } from './investments.service';

/**
 * الأدمن وحده — بأمر المالك في ٢٨ أغسطس ٢٠٢٦.
 *
 * ── ولماذا فحصٌ في الكود لا `ScreenGuard` ──
 * `ScreenGuard` يقرأ `allowed_screens`، وهي قوائمُ تُمنح وتُسحب. وهذا الكارت
 * يحمل قرضاً بين شركةٍ أمٍّ وتابعتها ومبالغَ استثمارٍ بالملايين — فالحدُّ فيه
 * **دورٌ لا منحة**: من ليس أدمن لا يُمنح، ولا يُنسى فيُمنح سهواً.
 */
function ensureAdmin(req: any) {
  if (req?.user?.role !== 'admin') throw new ForbiddenException('صلاحيات الأدمن مطلوبة');
}

@Controller('api/investments/stone')
@UseGuards(JwtAuthGuard)
export class InvestmentsController {
  constructor(private svc: InvestmentsService) {}

  /** الكارت كاملاً — الملخّص والدفاتر والتنبيهات في نداءٍ واحد. */
  @Get()
  card(@Request() req: any, @Query('as_of') asOf?: string) {
    ensureAdmin(req);
    return this.svc.card(asOf);
  }

  @Get('rounds')
  rounds(@Request() req: any) {
    ensureAdmin(req);
    return this.svc.listRounds();
  }

  @Post('rounds')
  addRound(@Request() req: any, @Body() b: any) {
    ensureAdmin(req);
    return this.svc.addRound(b);
  }

  /** حركةٌ في دفتر الأمّ — تغذيةٌ أو سداد، أصلٌ أو فائدة. */
  @Post('parent')
  addParent(@Request() req: any, @Body() b: any) {
    ensureAdmin(req);
    return this.svc.addParentMove(b, req.user?.id || '');
  }

  /** مساهمةٌ في Stone أو استردادٌ منها. */
  @Post('investment')
  addInvestment(@Request() req: any, @Body() b: any) {
    ensureAdmin(req);
    return this.svc.addInvestmentMove(b, req.user?.id || '');
  }

  @Post('bank')
  addBank(@Request() req: any, @Body() b: any) {
    ensureAdmin(req);
    return this.svc.addBankConfirmation(b, req.user?.id || '');
  }

  @Post('fund-call')
  addFundCall(@Request() req: any, @Body() b: any) {
    ensureAdmin(req);
    return this.svc.addFundCall(b);
  }

  @Post('vessel')
  addVessel(@Request() req: any, @Body() b: any) {
    ensureAdmin(req);
    return this.svc.addVessel(b);
  }

  @Post('open-item')
  addOpenItem(@Request() req: any, @Body() b: any) {
    ensureAdmin(req);
    return this.svc.addOpenItem(b);
  }

  @Patch('open-item/:id')
  setOpenItem(@Request() req: any, @Param('id') id: string, @Body() b: any) {
    ensureAdmin(req);
    return this.svc.setOpenItemStatus(id, String(b?.status || ''));
  }

  /**
   * شرطُ فائدةٍ جديد.
   *
   * وإدخالُه **لا يُقيّد شيئاً** في دفتر الأمّ: المحرّك يحسب تقديراً يُعرض،
   * والقيدُ يُدخَل بيدك من `POST parent` بنوع `interest` بعد أن تُصادق.
   */
  @Post('interest-term')
  addTerm(@Request() req: any, @Body() b: any) {
    ensureAdmin(req);
    return this.svc.addInterestTerm(b, req.user?.id || '');
  }

  /** حذفُ قيدٍ واحدٍ بمعرّفه — ولا حذفَ جماعيّ. */
  @Delete(':table/:id')
  remove(@Request() req: any, @Param('table') table: string, @Param('id') id: string) {
    ensureAdmin(req);
    return this.svc.removeRow(table, id);
  }
}
