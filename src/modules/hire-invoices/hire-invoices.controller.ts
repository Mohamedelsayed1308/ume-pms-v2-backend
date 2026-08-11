import { Controller, Get, Post, Put, Delete, Body, Param, UseGuards, Query } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { HireInvoice } from './hire-invoice.entity';
import { HireInvoiceItem } from './hire-invoice-item.entity';
import { HirePayment } from './hire-payment.entity';
import { JwtAuthGuard } from '../../common/jwt-auth.guard';
import { ScreenGuard } from '../../common/screen.guard';
import { RequireScreen } from '../../common/require-screen.decorator';
import { HirePaymentsService } from './hire-payments.service';

@Controller('api/hire-invoices')
@UseGuards(JwtAuthGuard, ScreenGuard)
@RequireScreen('/dashboard/hire-invoices')
export class HireInvoicesController {
  constructor(
    @InjectRepository(HireInvoice) private repo: Repository<HireInvoice>,
    @InjectRepository(HireInvoiceItem) private itemRepo: Repository<HireInvoiceItem>,
    @InjectRepository(HirePayment) private payRepo: Repository<HirePayment>,
    private payments: HirePaymentsService,
  ) {}

  @Get()
  async findAll(@Query('status') status?: string) {
    const where = status ? { status } : {};
    const rows = await this.repo.find({
      where,
      relations: { customer: true, vessel: true, shipping_company: true, items: true, payments: true, related_invoice: true },
      order: { invoice_date: 'DESC' },
    });
    return this.attachAdjustments(rows);
  }

  @Get('due')
  findDue() {
    // الإشعارات ليست مستحقات — فقط الفواتير العادية غير المسددة/الجزئية
    return this.repo.find({
      where: [{ status: 'unpaid', doc_type: 'invoice' }, { status: 'partial', doc_type: 'invoice' }],
      relations: { customer: true, vessel: true, shipping_company: true },
      order: { invoice_date: 'ASC' },
    });
  }

  // يحسب صافي المتبقّي لكل فاتورة بعد خصم الإشعارات الدائنة وإضافة المدينة (الفاتورة الأصلية تبقى ثابتة)
  private attachAdjustments(rows: HireInvoice[]) {
    const notes = rows.filter((r) => r.doc_type === 'credit_note' || r.doc_type === 'debit_note');
    const byInvoice: Record<string, { credit: number; debit: number }> = {};
    for (const nt of notes) {
      if (!nt.related_invoice_id) continue;
      const b = (byInvoice[nt.related_invoice_id] ||= { credit: 0, debit: 0 });
      if (nt.doc_type === 'credit_note') b.credit += +nt.total_amount;
      else b.debit += +nt.total_amount;
    }
    return rows.map((r) => {
      if (r.doc_type !== 'invoice') return { ...r, credit_total: 0, debit_total: 0, net_outstanding: null };
      const adj = byInvoice[r.id] || { credit: 0, debit: 0 };
      const net = +r.total_amount + adj.debit - adj.credit - +r.paid_amount;
      return { ...r, credit_total: adj.credit, debit_total: adj.debit, net_outstanding: +net.toFixed(2) };
    });
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.repo.findOne({
      where: { id },
      relations: { customer: true, vessel: true, shipping_company: true, items: true, payments: true, related_invoice: true },
    });
  }

  // يحوّل النصوص الفارغة في حقول التواريخ/المفاتيح إلى null (عمود date/uuid لا يقبل '')
  private sanitize(data: any) {
    for (const f of ['cp_date', 'hire_from', 'hire_to', 'related_invoice_id']) {
      if (data[f] === '') data[f] = null;
    }
    return data;
  }

  @Post()
  async create(@Body() body: any) {
    const { items, ...invoiceData } = body;
    this.sanitize(invoiceData);
    // الإشعارات لا تخضع لدورة السداد — حالتها «صادر»
    if (invoiceData.doc_type === 'credit_note' || invoiceData.doc_type === 'debit_note') {
      invoiceData.status = 'issued';
    }
    const invoice = this.repo.create(invoiceData);
    const saved = await this.repo.save(invoice) as unknown as HireInvoice;
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
    this.sanitize(invoiceData);
    if (invoiceData.doc_type === 'credit_note' || invoiceData.doc_type === 'debit_note') {
      invoiceData.status = 'issued';
    }
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

  // ── R3C · السداد ────────────────────────────────────────────────────────
  // المنطق المالي في الخدمة: تحقّق ثم معاملة واحدة مع قفل صف الفاتورة.
  // المتحكّم مسؤول عن HTTP والصلاحيات فقط.
  @Post(':id/payments')
  async addPayment(@Param('id') id: string, @Body() body: any) {
    await this.payments.addPayment(id, body);
    return this.repo.findOne({
      where: { id },
      relations: { customer: true, vessel: true, shipping_company: true, items: true, payments: true },
    });
  }

  @Delete(':id/payments/:paymentId')
  removePayment(@Param('id') id: string, @Param('paymentId') paymentId: string) {
    return this.payments.removePayment(id, paymentId);
  }
}
