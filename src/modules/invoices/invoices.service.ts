import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThanOrEqual, Not, Repository } from 'typeorm';
import { Invoice, InvoiceStatus } from './invoice.entity';

@Injectable()
export class InvoicesService {
  constructor(@InjectRepository(Invoice) private repo: Repository<Invoice>) {}

  findAll() {
    return this.repo.find({
      relations: { supplier: true, vessel: true, purchase_order: true, payments: true },
      order: { created_at: 'DESC' },
    });
  }

  findOne(id: string) {
    return this.repo.findOne({
      where: { id },
      relations: { supplier: true, vessel: true, purchase_order: true, payments: true },
    });
  }

  create(data: Partial<Invoice>) { return this.repo.save(data); }

  async update(id: string, data: Partial<Invoice>) {
    await this.repo.update(id, data);
    return this.findOne(id);
  }

  async remove(id: string) { await this.repo.delete(id); return { deleted: true }; }

  async updatePaidAmount(invoiceId: string) {
    const invoice = await this.repo.findOne({
      where: { id: invoiceId },
      relations: { payments: true },
    });
    if (!invoice) return;

    const totalPaid = invoice.payments.reduce((sum, p) => sum + +p.amount, 0);
    const status =
      totalPaid <= 0 ? InvoiceStatus.UNPAID
      : totalPaid >= +invoice.total_amount ? InvoiceStatus.PAID
      : InvoiceStatus.PARTIAL;

    await this.repo.update(invoiceId, { paid_amount: totalPaid, status });
  }

  findBySupplier(supplierId: string) {
    return this.repo.find({
      where: { supplier_id: supplierId },
      relations: { vessel: true, purchase_order: true, payments: true },
      order: { created_at: 'DESC' },
    });
  }

  findByVessel(vesselId: string) {
    return this.repo.find({
      where: { vessel_id: vesselId },
      relations: { supplier: true, purchase_order: true, payments: true },
      order: { created_at: 'DESC' },
    });
  }

  findUnpaidBySupplier(supplierId: string) {
    return this.repo.find({
      where: [
        { supplier_id: supplierId, status: InvoiceStatus.UNPAID },
        { supplier_id: supplierId, status: InvoiceStatus.PARTIAL },
      ],
      relations: { vessel: true, purchase_order: true, payments: true },
      order: { due_date: 'ASC' },
    });
  }

  findUnpaidByVessel(vesselId: string) {
    return this.repo.find({
      where: [
        { vessel_id: vesselId, status: InvoiceStatus.UNPAID },
        { vessel_id: vesselId, status: InvoiceStatus.PARTIAL },
      ],
      relations: { supplier: true, purchase_order: true, payments: true },
      order: { due_date: 'ASC' },
    });
  }

  async getSupplierStatement(supplierId: string) {
    const invoices = await this.repo.find({
      where: { supplier_id: supplierId },
      relations: { supplier: true, vessel: true, purchase_order: true, payments: true },
      order: { invoice_date: 'ASC' },
    });

    if (!invoices.length) return { supplier: null, transactions: [], summary: { total_debit: 0, total_credit: 0, balance: 0 } };

    const supplier = invoices[0].supplier;
    const transactions: any[] = [];
    let running_balance = 0;

    for (const inv of invoices) {
      // الفاتورة = مدين
      running_balance += +inv.total_amount;
      transactions.push({
        date: inv.invoice_date,
        type: 'debit',
        type_ar: 'مدين',
        description: `فاتورة رقم ${inv.invoice_number}`,
        invoice_number: inv.invoice_number,
        invoice_type: inv.type,
        vessel: inv.vessel?.name ?? null,
        po_number: inv.purchase_order?.po_number ?? null,
        currency: inv.currency,
        debit: +inv.total_amount,
        credit: 0,
        running_balance,
        status: inv.status,
      });

      // كل دفعة = دائن
      const payments = (inv.payments || []).sort(
        (a, b) => new Date(a.payment_date).getTime() - new Date(b.payment_date).getTime()
      );
      for (const pay of payments) {
        running_balance -= +pay.amount;
        transactions.push({
          date: pay.payment_date,
          type: 'credit',
          type_ar: 'دائن',
          description: `سداد — ${inv.invoice_number}`,
          invoice_number: inv.invoice_number,
          payment_method: pay.payment_method,
          reference: pay.reference ?? null,
          currency: pay.currency,
          debit: 0,
          credit: +pay.amount,
          running_balance,
        });
      }
    }

    transactions.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    const total_debit = transactions.reduce((s, t) => s + t.debit, 0);
    const total_credit = transactions.reduce((s, t) => s + t.credit, 0);

    return {
      supplier: { id: supplier.id, name: supplier.name },
      transactions,
      summary: {
        total_debit,
        total_credit,
        balance: total_debit - total_credit,
      },
    };
  }

  async reportDepartmentDelays() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const deptMap: Record<string, string> = {
      waiting_po: 'Purchasing Dept',
      delivery_missing: 'Purchasing Dept',
      send_to_pay: 'Payments & Treasury Dept',
    };

    const invoices = await this.repo.find({
      where: [
        { approval_status: 'waiting_po' as any },
        { approval_status: 'delivery_missing' as any },
        { approval_status: 'send_to_pay' as any },
      ],
      relations: { supplier: true, vessel: true },
      order: { approval_status_date: 'ASC' },
    });

    return invoices
      .filter((inv) => inv.approval_status_date)
      .map((inv) => {
        const statusDate = new Date(inv.approval_status_date);
        const diffMs = today.getTime() - statusDate.getTime();
        const days_delayed = Math.floor(diffMs / (1000 * 60 * 60 * 24));
        return {
          id: inv.id,
          invoice_number: inv.invoice_number,
          supplier: inv.supplier?.name,
          vessel: inv.vessel?.name,
          total_amount: inv.total_amount,
          currency: inv.currency,
          approval_status: inv.approval_status,
          approval_status_date: inv.approval_status_date,
          days_delayed,
          department: deptMap[inv.approval_status] || '—',
          is_delayed: days_delayed > 3,
        };
      })
      .filter((inv) => inv.is_delayed)
      .sort((a, b) => b.days_delayed - a.days_delayed);
  }

  async reportByUser() {
    const invoices = await this.repo.find({
      relations: { vessel: true },
      order: { created_at: 'DESC' },
    });

    const map: Record<string, any> = {};
    for (const inv of invoices) {
      const userName = inv.created_by_name || 'غير معروف';
      const userId = inv.created_by_id || 'unknown';
      if (!map[userId]) {
        map[userId] = { user_id: userId, user_name: userName, total: 0, by_vessel: {} };
      }
      map[userId].total += 1;
      const vesselName = inv.vessel?.name || 'بدون سفينة';
      map[userId].by_vessel[vesselName] = (map[userId].by_vessel[vesselName] || 0) + 1;
    }

    return Object.values(map).map((u) => ({
      ...u,
      by_vessel: Object.entries(u.by_vessel).map(([vessel, count]) => ({ vessel, count })),
    }));
  }

  getDueAlerts(daysAhead = 30) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const futureDate = new Date(today);
    futureDate.setDate(futureDate.getDate() + daysAhead);

    return this.repo.find({
      where: {
        due_date: LessThanOrEqual(futureDate),
        status: Not(InvoiceStatus.PAID),
      },
      relations: { supplier: true, vessel: true, purchase_order: true },
      order: { due_date: 'ASC' },
    }).then((invoices) =>
      invoices.map((inv) => {
        const due = new Date(inv.due_date);
        const diffMs = due.getTime() - today.getTime();
        const days_until_due = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
        return {
          ...inv,
          days_until_due,
          is_overdue: days_until_due < 0,
        };
      })
    );
  }
}
