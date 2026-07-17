import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Payment } from './payment.entity';
import { InvoicesService } from '../invoices/invoices.service';

@Injectable()
export class PaymentsService {
  constructor(
    @InjectRepository(Payment) private repo: Repository<Payment>,
    private invoicesService: InvoicesService,
  ) {}

  findAll() {
    return this.repo.find({
      relations: { invoice: { supplier: true, vessel: true } },
      order: { created_at: 'DESC' },
    });
  }

  findOne(id: string) {
    return this.repo.findOne({ where: { id }, relations: { invoice: true } });
  }

  findByInvoice(invoiceId: string) {
    return this.repo.find({
      where: { invoice_id: invoiceId },
      order: { payment_date: 'ASC' },
    });
  }

  async create(data: Partial<Payment>) {
    const payment = await this.repo.save(data);
    await this.invoicesService.updatePaidAmount(payment.invoice_id);
    return payment;
  }

  async remove(id: string) {
    const payment = await this.repo.findOneBy({ id });
    await this.repo.delete(id);
    if (payment) await this.invoicesService.updatePaidAmount(payment.invoice_id);
    return { deleted: true };
  }
}
