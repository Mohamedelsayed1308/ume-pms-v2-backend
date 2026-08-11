import { Controller, Get, Post, Put, Delete, Body, Param, UseGuards, Query } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ManagementInvoice } from './management-invoice.entity';
import { ManagementPayment } from './management-payment.entity';
import { JwtAuthGuard } from '../../common/jwt-auth.guard';
import { ScreenGuard } from '../../common/screen.guard';
import { RequireScreen } from '../../common/require-screen.decorator';
import { ManagementPaymentsService } from './management-payments.service';

@Controller('api/management-invoices')
@UseGuards(JwtAuthGuard, ScreenGuard)
@RequireScreen('/dashboard/management-invoices')
export class ManagementInvoicesController {
  constructor(
    @InjectRepository(ManagementInvoice) private repo: Repository<ManagementInvoice>,
    @InjectRepository(ManagementPayment) private payRepo: Repository<ManagementPayment>,
    private payments: ManagementPaymentsService,
  ) {}

  @Get()
  findAll(@Query('status') status?: string) {
    const where = status ? { status } : {};
    return this.repo.find({
      where,
      relations: { vessel: true, payments: true },
      order: { invoice_date: 'DESC' },
    });
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.repo.findOne({
      where: { id },
      relations: { vessel: true, payments: true },
    });
  }

  @Post()
  async create(@Body() body: any) {
    const invoice = this.repo.create(body);
    const saved = await this.repo.save(invoice) as unknown as ManagementInvoice;
    return this.repo.findOne({ where: { id: saved.id }, relations: { vessel: true, payments: true } });
  }

  @Put(':id')
  async update(@Param('id') id: string, @Body() body: any) {
    await this.repo.update(id, body);
    return this.repo.findOne({ where: { id }, relations: { vessel: true, payments: true } });
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    await this.repo.delete(id);
    return { success: true };
  }

  // ── R3C · السداد — نفس محرّك دفتر الإيجار، بإعداد مختلف لا بكود مكرَّر ──
  @Post(':id/payments')
  async addPayment(@Param('id') id: string, @Body() body: any) {
    await this.payments.addPayment(id, body);
    return this.repo.findOne({ where: { id }, relations: { vessel: true, payments: true } });
  }

  @Delete(':id/payments/:paymentId')
  removePayment(@Param('id') id: string, @Param('paymentId') paymentId: string) {
    return this.payments.removePayment(id, paymentId);
  }
}
