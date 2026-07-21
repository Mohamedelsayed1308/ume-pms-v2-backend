import { Controller, Get, Post, Put, Delete, Body, Param, UseGuards, Query } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ManagementInvoice } from './management-invoice.entity';
import { ManagementPayment } from './management-payment.entity';
import { JwtAuthGuard } from '../../common/jwt-auth.guard';

@Controller('api/management-invoices')
@UseGuards(JwtAuthGuard)
export class ManagementInvoicesController {
  constructor(
    @InjectRepository(ManagementInvoice) private repo: Repository<ManagementInvoice>,
    @InjectRepository(ManagementPayment) private payRepo: Repository<ManagementPayment>,
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

  @Post(':id/payments')
  async addPayment(@Param('id') id: string, @Body() body: any) {
    const payment = this.payRepo.create({ ...body, management_invoice_id: id });
    await this.payRepo.save(payment);
    const invoice = await this.repo.findOne({ where: { id }, relations: { payments: true } });
    if (invoice) {
      const totalPaid = invoice.payments.reduce((s, p) => s + +p.amount, 0);
      const status = totalPaid >= +invoice.amount ? 'paid' : totalPaid > 0 ? 'partial' : 'unpaid';
      await this.repo.update(id, { paid_amount: totalPaid, status });
    }
    return this.repo.findOne({ where: { id }, relations: { vessel: true, payments: true } });
  }

  @Delete(':id/payments/:paymentId')
  async removePayment(@Param('id') id: string, @Param('paymentId') paymentId: string) {
    await this.payRepo.delete(paymentId);
    const invoice = await this.repo.findOne({ where: { id }, relations: { payments: true } });
    if (invoice) {
      const totalPaid = invoice.payments.reduce((s, p) => s + +p.amount, 0);
      const status = totalPaid >= +invoice.amount ? 'paid' : totalPaid > 0 ? 'partial' : 'unpaid';
      await this.repo.update(id, { paid_amount: totalPaid, status });
    }
    return { success: true };
  }
}
