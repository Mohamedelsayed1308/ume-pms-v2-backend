import { Controller, Get, Post, Body, Param, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/jwt-auth.guard';
import { ScreenGuard } from '../../common/screen.guard';
import { RequireScreen } from '../../common/require-screen.decorator';
import { BrokersService } from './brokers.service';

/**
 * حسابات البروكر — تعيش تحت شاشة فواتير الإيجار.
 *
 * فالعمولة تُولد من الفاتورة وتُتابَع معها، ومن يرى الفواتير هو من يرى ما
 * عليها. فلا شاشةَ صلاحيّاتٍ جديدة تُدار.
 */
@Controller('api/brokers')
@UseGuards(JwtAuthGuard, ScreenGuard)
@RequireScreen('/dashboard/hire-invoices')
export class BrokersController {
  constructor(private svc: BrokersService) {}

  private who(req: any): string {
    return String(req?.user?.username || req?.user?.email || req?.user?.id || '');
  }

  @Get()
  list() { return this.svc.listBrokers(); }

  @Get('rules')
  rules() { return this.svc.listRules(); }

  /** كشوف البروكرين معاً — للشاشة والبطاقة. */
  @Get('accounts')
  accounts() { return this.svc.allAccounts(); }

  /** ملخّصُ كلّ فاتورة — للشارة في القائمة. */
  @Get('invoice-summary')
  invoiceSummary() { return this.svc.invoiceSummary(); }

  @Get(':id/account')
  account(@Param('id') id: string) { return this.svc.account(id); }

  @Post('payments')
  pay(
    @Body() body: { brokerId: string; amount: number; invoiceId?: string | null; reference?: string; note?: string },
    @Req() req: any,
  ) {
    return this.svc.pay(body, this.who(req));
  }

  @Post('payments/:id/delete')
  deletePayment(@Param('id') id: string, @Body() body: { reason?: string }, @Req() req: any) {
    return this.svc.deletePayment(id, String(body?.reason || ''), this.who(req));
  }

  /**
   * إعادةُ مزامنةِ استحقاقات فاتورة — للحالات التي تُصلَّح يداً.
   *
   * والمزامنة تجري تلقائيّاً عند كلّ حفظ، فهذا لمن أراد أن يُجريها صراحةً
   * على فاتورةٍ قديمة بلا أن يفتحها ويحفظها.
   */
  @Post('sync/:invoiceId')
  sync(@Param('invoiceId') invoiceId: string, @Req() req: any) {
    return this.svc.syncInvoice(invoiceId, this.who(req));
  }
}
