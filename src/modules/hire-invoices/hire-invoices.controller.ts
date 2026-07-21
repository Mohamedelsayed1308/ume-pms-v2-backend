import { Controller, Get, Post, Put, Delete, Body, Param, UseGuards, Query } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { HireInvoice } from './hire-invoice.entity';
import { HireInvoiceItem } from './hire-invoice-item.entity';
import { HirePayment } from './hire-payment.entity';
import { JwtAuthGuard } from '../../common/jwt-auth.guard';

@Controller('api/hire-invoices')
@UseGuards(JwtAuthGuard)
export class HireInvoicesController {
  constructor(
    @InjectRepository(HireInvoice) private repo: Repository<HireInvoice>,
    @InjectRepository(HireInvoiceItem) private itemRepo: Repository<HireInvoiceItem>,
    @InjectRepository(HirePayment) private payRepo: Repository<HirePayment>,
  ) {}

  @Get()
  findAll(@Query('status') status?: string) {
    const where = status ? { status } : {};
    return this.repo.find({
      where,
      relations: { customer: true, vessel: true, shipping_company: true, items: true, payments: true },
      order: { invoice_date: 'DESC' },
    });
  }

  @Get('due')
  findDue() {
    return this.repo.find({
      where: [{ status: 'unpaid' }, { status: 'partial' }],
      relations: { customer: true, vessel: true, shipping_company: true },
      order: { invoice_date: 'ASC' },
    });
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.repo.findOne({
      where: { id },
      relations: { customer: true, vessel: true, shipping_company: true, items: true, payments: true },
    });
  }

  @Post()
  async create(@Body() body: any) {
    const { items, ...invoiceData } = body;
    const invoice = this.repo.create(invoiceData);
    const saved = await this.repo.save(invoice);
    if (items?.length) {
      const itemEntities = items.map((it: any, i: number) =>
        this.itemRepo.create({ ...it, hire_invoice_id: saved.id, sort_order: i })
      );
      await this.itemRepo.save(itemEntities);
    }
    return this.repo.findOne({
      where: { id: saved.id },
      relations: { customer: true, vessel: true, shipping_company: true, items: true },
    });
  }

  @Put(':id')
  async update(@Param('id') id: string, @Body() body: any) {
    const { items, ...invoiceData } = body;
    await this.repo.update(id, invoiceData);
    if (items) {
      await this.itemRepo.delete({ hire_invoice_id: id });
      if (items.length) {
        const itemEntities = items.map((it: any, i: number) =>
          this.itemRepo.create({ ...it, hire_invoice_id: id, sort_order: i })
        );
        await this.itemRepo.save(itemEntities);
      }
    }
    return this.repo.findOne({
      where: { id },
      relations: { customer: true, vessel: true, shipping_company: true, items: true, payments: true },
    });
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    await this.repo.delete(id);
    return { success: true };
  }

  @Post(':id/payments')
  async addPayment(@Param('id') id: string, @Body() body: any) {
    const payment = this.payRepo.create({ ...body, hire_invoice_id: id });
    await this.payRepo.save(payment);

    const invoice = await this.repo.findOne({ where: { id }, relations: { payments: true } });
    const totalPaid = invoice.payments.reduce((s, p) => s + +p.amount, 0);
    const status = totalPaid >= +invoice.total_amount ? 'paid' : totalPaid > 0 ? 'partial' : 'unpaid';
    await this.repo.update(id, { paid_amount: totalPaid, status });

    return this.repo.findOne({
      where: { id },
      relations: { customer: true, vessel: true, shipping_company: true, items: true, payments: true },
    });
  }

  @Delete(':id/payments/:paymentId')
  async removePayment(@Param('id') id: string, @Param('paymentId') paymentId: string) {
    await this.payRepo.delete(paymentId);

    const invoice = await this.repo.findOne({ where: { id }, relations: { payments: true } });
    const totalPaid = invoice.payments.reduce((s, p) => s + +p.amount, 0);
    const status = totalPaid >= +invoice.total_amount ? 'paid' : totalPaid > 0 ? 'partial' : 'unpaid';
    await this.repo.update(id, { paid_amount: totalPaid, status });

    return { success: true };
  }
}
