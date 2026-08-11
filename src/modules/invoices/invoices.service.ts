import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThanOrEqual, Not, Repository } from 'typeorm';
import { Invoice, InvoiceStatus } from './invoice.entity';
import { Attachment } from '../attachments/attachment.entity';
import { stripSystemControlledFields } from '../../common/financial-control-fields';
import { derivePaymentState, isLegacySettled } from '../../common/payment-derivation';

// ملخّص كشف الحساب لعملة واحدة — لا يُجمع أبداً مع عملة أخرى
export interface CurrencySummary { total_debit: number; total_credit: number; balance: number; }

// دفتر مستقل لكل عملة: كل عملة Ledger قائم بذاته بلا أي تحويل أو إجمالي موحّد
export interface CurrencyLedger {
  currency: string;
  openingBalance: number;   // 0 دائماً — الكشف لا يدعم فترة زمنية (يشمل كل التاريخ)
  invoicesTotal: number;
  paymentsTotal: number;
  creditsTotal: number;     // الإشعارات الدائنة (فواتير بمبلغ سالب)
  closingBalance: number;
  transactions: any[];
}

export const normalizeCurrency = (c?: string | null) => (c || 'USD').trim().toUpperCase();
export const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

@Injectable()
export class InvoicesService {
  constructor(
    @InjectRepository(Invoice) private repo: Repository<Invoice>,
    @InjectRepository(Attachment) private attachmentRepo: Repository<Attachment>,
  ) {}

  findAll() {
    return this.repo.find({
      relations: { supplier: true, vessel: true, purchase_order: true, payments: true, item: true },
      order: { created_at: 'DESC' },
    });
  }

  findOne(id: string) {
    return this.repo.findOne({
      where: { id },
      relations: { supplier: true, vessel: true, purchase_order: true, payments: true, item: true },
    });
  }

  // ── R3B · فصل الموافقة عن السداد ───────────────────────────────────────────
  // approval_status سير عمل إداري بحت. `paid` فيه تعني «معتمد للصرف» لا «سُدِّد».
  // لا يكتب حالة سداد ولا paid_amount ولا يُنشئ سجل دفع — مهما كانت قيمته.
  // حالة السداد تُشتقّ حصراً من سجلات الدفع الفعلية عبر updatePaidAmount.
  //
  // كان الاقتران هنا هو ما أنتج 128 فاتورة «مدفوعة» بلا سند دفع.
  async create(data: Partial<Invoice>) {
    data = stripSystemControlledFields(data);   // الطبقة 2 — دفاع عميق
    const saved = await this.repo.save(data);
    const row = Array.isArray(saved) ? saved[0] : saved;
    return this.findOne(row.id);
  }

  async update(id: string, data: Partial<Invoice>) {
    data = stripSystemControlledFields(data);   // الطبقة 2 — دفاع عميق
    await this.repo.update(id, data);
    // لا أثر لتغيير الموافقة على حالة السداد — لا كتابة ولا إعادة اشتقاق.
    // السجلات القائمة لا تُعاد كتابتها تلقائياً.
    return this.findOne(id);
  }

  async remove(id: string) {
    await this.attachmentRepo.delete({ invoice_id: id });
    await this.repo.delete(id);
    return { deleted: true };
  }

  /**
   * المسار المشروع **الوحيد** الذي يكتب paid_amount وstatus.
   * paid_amount حقل مشتقّ (cache) لا مصدر حقيقة — مصدرها سجلات الدفع.
   */
  async updatePaidAmount(invoiceId: string) {
    const invoice = await this.repo.findOne({
      where: { id: invoiceId },
      relations: { payments: true },
    });
    if (!invoice) return;
    if (isLegacySettled(invoice)) return;   // ← لا تلمس تسوية تاريخية

    const { paidAmount, status } = derivePaymentState(invoice as any, invoice.payments || []);
    await this.repo.update(invoiceId, { paid_amount: paidAmount, status });
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
      relations: { supplier: true, purchase_order: true, payments: true, item: true },
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

  // كشف حساب المورد — دفتر مستقل لكل عملة. لا تُجمع عملتان في أي رقم، ولا يوجد إجمالي موحّد.
  // ملاحظة نطاق: لا يدعم فترة زمنية (يشمل كل التاريخ)، لذا openingBalance = 0 لكل عملة.
  async getSupplierStatement(supplierId: string) {
    const invoices = await this.repo.find({
      where: { supplier_id: supplierId },
      relations: { supplier: true, vessel: true, purchase_order: true, payments: true },
      order: { invoice_date: 'ASC' },
    });

    const empty = {
      supplier: null,
      statementPeriod: { from: null as string | null, to: null as string | null },
      currencies: [] as CurrencyLedger[],
      transactions: [] as any[],
      summary_by_currency: {} as Record<string, CurrencySummary>,
      summary: { total_debit: 0, total_credit: 0, balance: 0, currency: null as string | null, mixed_currency: false },
    };
    if (!invoices.length) return empty;

    const supplier = invoices[0].supplier;
    const transactions: any[] = [];

    for (const inv of invoices) {
      const ccy = normalizeCurrency(inv.currency);
      const amount = +inv.total_amount;
      // فاتورة بمبلغ سالب = إشعار دائن ⇒ تُقيَّد دائناً بقيمتها المطلقة (تقلّل التزام المورد، ولا تُعكس إشارتها)
      const isCreditNote = amount < 0;
      transactions.push({
        date: inv.invoice_date,
        created_at: inv.created_at,
        id: `inv:${inv.id}`,
        type: isCreditNote ? 'credit' : 'debit',
        kind: isCreditNote ? 'credit_note' : 'invoice',
        type_ar: isCreditNote ? 'إشعار دائن' : 'مدين',
        description: `${isCreditNote ? 'إشعار دائن' : 'فاتورة'} رقم ${inv.invoice_number}`,
        reference: inv.invoice_number,
        invoiceId: inv.id,
        invoiceNumber: inv.invoice_number,
        invoice_number: inv.invoice_number,        // توافق رجعي
        invoice_type: inv.type,
        vessel: inv.vessel?.name ?? null,
        po_number: inv.purchase_order?.po_number ?? null,
        currency: ccy,
        debit: isCreditNote ? 0 : amount,
        credit: isCreditNote ? Math.abs(amount) : 0,
        status: inv.status,
      });

      // كل دفعة = دائن، وتبقى في عملتها الأصلية دون أي تحويل
      const payments = [...(inv.payments || [])].sort(
        (a, b) => new Date(a.payment_date).getTime() - new Date(b.payment_date).getTime()
      );
      for (const pay of payments) {
        transactions.push({
          date: pay.payment_date,
          created_at: pay.created_at,
          id: `pay:${pay.id}`,
          type: 'credit',
          kind: 'payment',
          type_ar: 'دائن',
          description: `سداد — ${inv.invoice_number}`,
          reference: pay.reference ?? null,
          invoiceId: inv.id,
          invoiceNumber: inv.invoice_number,
          invoice_number: inv.invoice_number,
          payment_method: pay.payment_method,
          currency: normalizeCurrency(pay.currency),
          debit: 0,
          credit: +pay.amount,
        });
      }

      // ── R3B · فرق بلا سند دفع داخل PMS ──────────────────────────────────
      // يُقيَّد دائناً لأن الرصيد مغلق فعلاً، لكن الوصف يجب ألا يوهم بوجود سداد.
      // بعد فكّ الاقتران لن ينشأ هذا الفرق للفواتير التشغيلية الجديدة أصلاً؛
      // ما يبقى هو التسويات التاريخية الموسومة في R3A.
      const paymentsSum = payments.reduce((s, p) => s + +p.amount, 0);
      const approvalPaid = +inv.paid_amount - paymentsSum;
      if (approvalPaid > 0.001) {
        const legacy = isLegacySettled(inv as any);
        transactions.push({
          date: inv.approval_status_date || inv.invoice_date,
          created_at: inv.updated_at,
          id: `apv:${inv.id}`,
          type: 'credit',
          kind: legacy ? 'legacy_settlement' : 'unevidenced_settlement',
          type_ar: 'دائن',
          description: legacy
            ? `تسوية تاريخية قبل النظام — ${inv.invoice_number}`
            : `إغلاق بلا سند دفع داخل النظام — ${inv.invoice_number}`,
          reference: inv.invoice_number,
          invoiceId: inv.id,
          invoiceNumber: inv.invoice_number,
          invoice_number: inv.invoice_number,
          currency: ccy,
          debit: 0,
          credit: approvalPaid,
        });
      }
    }

    // ترتيب حتمي: التاريخ ثم الإنشاء ثم المعرّف — حتى لا يتغيّر الرصيد المتراكم عشوائياً
    const key = (t: any) => [
      new Date(t.date || 0).getTime(),
      new Date(t.created_at || 0).getTime() || 0,
      String(t.id),
    ];
    transactions.sort((a, b) => {
      const [ad, ac, ai] = key(a), [bd, bc, bi] = key(b);
      return (ad as number) - (bd as number) || (ac as number) - (bc as number) || String(ai).localeCompare(String(bi));
    });

    // دفتر مستقل لكل عملة — الرصيد المتراكم داخل نفس العملة فقط
    const ledgers = new Map<string, CurrencyLedger>();
    for (const t of transactions) {
      let L = ledgers.get(t.currency);
      if (!L) {
        L = { currency: t.currency, openingBalance: 0, invoicesTotal: 0, paymentsTotal: 0, creditsTotal: 0, closingBalance: 0, transactions: [] };
        ledgers.set(t.currency, L);
      }
      if (t.kind === 'invoice') L.invoicesTotal = round2(L.invoicesTotal + t.debit);
      else if (t.kind === 'credit_note') L.creditsTotal = round2(L.creditsTotal + t.credit);
      else L.paymentsTotal = round2(L.paymentsTotal + t.credit);

      L.closingBalance = round2(L.closingBalance + t.debit - t.credit);
      t.balance = L.closingBalance;          // رصيد متراكم داخل العملة
      t.running_balance = L.closingBalance;  // توافق رجعي
      L.transactions.push(t);
    }

    const currencies = [...ledgers.values()].sort((a, b) => a.currency.localeCompare(b.currency));

    // مُلخّص لكل عملة (توافق رجعي) — لا يُجمع أبداً عبر العملات
    const summary_by_currency: Record<string, CurrencySummary> = {};
    for (const L of currencies) {
      summary_by_currency[L.currency] = {
        total_debit: L.invoicesTotal,
        total_credit: round2(L.paymentsTotal + L.creditsTotal),
        balance: L.closingBalance,
      };
    }

    // الحقل القديم: أرقام حقيقية لمورد أحادي العملة فقط، وأصفار + mixed_currency عند التعدّد
    const only = currencies.length === 1 ? currencies[0] : null;
    const summary = only
      ? { ...summary_by_currency[only.currency], currency: only.currency, mixed_currency: false }
      : { total_debit: 0, total_credit: 0, balance: 0, currency: null, mixed_currency: currencies.length > 1 };

    const dates = transactions.map((t) => t.date).filter(Boolean).sort();
    return {
      supplier: { id: supplier.id, name: supplier.name },
      statementPeriod: { from: dates[0] ?? null, to: dates[dates.length - 1] ?? null },
      currencies,
      transactions,
      summary_by_currency,
      summary,
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
