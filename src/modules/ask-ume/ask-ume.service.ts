import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Invoice } from '../invoices/invoice.entity';
import { Payment } from '../payments/payment.entity';
import { Supplier } from '../suppliers/supplier.entity';
import { Vessel } from '../vessels/vessel.entity';
import { Task } from '../tasks/task.entity';
import { User } from '../auth/user.entity';

// ── الشاشات (نفس مسارات الفرونت) ──
export const SCREEN = {
  invoices: '/dashboard/invoices',
  payments: '/dashboard/payments',
  suppliers: '/dashboard/suppliers',
  vessels: '/dashboard/vessels',
  purchaseOrders: '/dashboard/purchase-orders',
  tasks: '/dashboard/tasks',
  reports: '/dashboard/reports',
};

export interface PermCtx { isAdmin: boolean; allowed: string[] | null; can: (href: string) => boolean; }

// ── نتيجة أداة موحّدة ──
export interface ToolResult {
  source: string;                                   // فئة المصدر (Invoices/Payments/...)
  facts: { label: string; value: string }[];        // حقائق رقمية للعرض
  limitations: string[];                            // تنويهات (بيانات جزئية...)
  actions: { label: string; route: string }[];      // تنقّل مقترح
  data: any;                                        // سياق منظّم مصغّر للنموذج
}

const n = (v: any) => { const x = Number(v); return isFinite(x) ? x : 0; };
const money = (v: number, c: string) => `${n(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${c}`;

function startOfToday(): Date { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }
function parseDate(s: any): Date | null {
  if (!s) return null;
  const str = typeof s === 'string' ? s.slice(0, 10) : new Date(s).toISOString().slice(0, 10);
  const m = str.split('-').map(Number);
  if (m.length < 3 || m.some((x) => !isFinite(x))) return null;
  return new Date(m[0], m[1] - 1, m[2]);
}
const invActive = (i: Invoice) => i.status === 'unpaid' || i.status === 'partial';
function isOverdue(i: Invoice, today: Date) { const d = parseDate(i.due_date); return !!d && invActive(i) && d < today; }
// تجميع لكل عملة (ممنوع الجمع عبر العملات)
function byCurrency<T>(arr: T[], amt: (t: T) => number, ccy: (t: T) => string): Record<string, number> {
  const o: Record<string, number> = {};
  for (const t of arr) { const c = (ccy(t) || 'USD').toUpperCase(); o[c] = (o[c] || 0) + n(amt(t)); }
  return o;
}
function ccyFacts(prefix: string, map: Record<string, number>): { label: string; value: string }[] {
  const e = Object.entries(map).filter(([, v]) => Math.abs(v) > 0.005).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
  if (!e.length) return [{ label: prefix, value: '0' }];
  return e.map(([c, v]) => ({ label: `${prefix} (${c})`, value: money(v, c) }));
}
function ccyText(map: Record<string, number>): string {
  const e = Object.entries(map).filter(([, v]) => Math.abs(v) > 0.005).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
  return e.length ? e.map(([c, v]) => money(v, c)).join(' · ') : '0';
}

@Injectable()
export class AskUmeService {
  constructor(
    @InjectRepository(Invoice) private invoiceRepo: Repository<Invoice>,
    @InjectRepository(Payment) private paymentRepo: Repository<Payment>,
    @InjectRepository(Supplier) private supplierRepo: Repository<Supplier>,
    @InjectRepository(Vessel) private vesselRepo: Repository<Vessel>,
    @InjectRepository(Task) private taskRepo: Repository<Task>,
    @InjectRepository(User) private userRepo: Repository<User>,
  ) {}

  // ── STEP 1: حلّ الصلاحيات من قاعدة البيانات (ليس من الفرونت) ──
  async resolvePermissions(userId: string): Promise<PermCtx> {
    const user = userId ? await this.userRepo.findOne({ where: { id: userId } }) : null;
    const isAdmin = user?.role === 'admin';
    const allowed = Array.isArray(user?.allowed_screens) ? (user!.allowed_screens as string[]) : null;
    const can = (href: string) => isAdmin || allowed === null || allowed.includes(href);
    return { isAdmin, allowed, can };
  }

  // خريطة الأداة → الشاشة المطلوبة
  static toolScreen(tool: string): string | null {
    const map: Record<string, string> = {
      getManagementSummary: '',                 // فئات مسموحة فقط (تُفلتر داخلياً)
      getSupplierSummary: SCREEN.suppliers,
      getOutstandingInvoices: SCREEN.invoices,
      getInvoiceSummary: SCREEN.invoices,
      getPaymentSummary: SCREEN.payments,
      getVesselSummary: SCREEN.vessels,
      getTaskAttention: SCREEN.tasks,
      getReportSummary: SCREEN.reports,
    };
    return map[tool] ?? null;
  }

  canUseTool(ctx: PermCtx, tool: string): boolean {
    if (tool === 'getManagementSummary') return true; // يفلتر أقسامه داخلياً
    const scr = AskUmeService.toolScreen(tool);
    return scr ? ctx.can(scr) : false;
  }

  // ── أدوات القراءة الحتمية ──
  private async loadInvoices() {
    return this.invoiceRepo.find({ relations: { supplier: true, vessel: true, purchase_order: true } as any });
  }

  async getOutstandingInvoices(ctx: PermCtx, scope: 'overdue' | 'due_soon' | 'largest_unpaid' = 'overdue'): Promise<ToolResult> {
    const today = startOfToday();
    const all = await this.loadInvoices();
    const unpaid = all.filter(invActive);
    let list = unpaid;
    if (scope === 'overdue') list = unpaid.filter((i) => isOverdue(i, today));
    else if (scope === 'due_soon') list = unpaid.filter((i) => { const d = parseDate(i.due_date); if (!d) return false; const df = (d.getTime() - today.getTime()) / 864e5; return df >= 0 && df <= 7; });
    const outstanding = byCurrency(list, (i) => n(i.total_amount) - n(i.paid_amount), (i) => i.currency);
    const top = [...list].sort((a, b) => (n(b.total_amount) - n(b.paid_amount)) - (n(a.total_amount) - n(a.paid_amount))).slice(0, 8)
      .map((i) => ({ invoice: i.invoice_number, supplier: i.supplier?.name || null, vessel: i.vessel?.name || null, currency: i.currency, outstanding: +(n(i.total_amount) - n(i.paid_amount)).toFixed(2), due_date: i.due_date, status: i.status }));
    const label = scope === 'overdue' ? 'Overdue' : scope === 'due_soon' ? 'Due within 7 days' : 'Largest unpaid';
    return {
      source: 'Invoices',
      facts: [{ label: `${label} invoices`, value: String(list.length) }, ...ccyFacts('Outstanding', outstanding)],
      limitations: [],
      actions: [{ label: 'Open invoices', route: SCREEN.invoices }],
      data: { queryType: 'outstanding_invoices', scope, count: list.length, outstandingByCurrency: outstanding, top },
    };
  }

  async getInvoiceSummary(ctx: PermCtx, invoiceNumber: string): Promise<ToolResult> {
    const all = await this.loadInvoices();
    const inv = all.find((i) => (i.invoice_number || '').toLowerCase() === (invoiceNumber || '').toLowerCase());
    if (!inv) return { source: 'Invoices', facts: [], limitations: [`No invoice found matching "${invoiceNumber}".`], actions: [{ label: 'Open invoices', route: SCREEN.invoices }], data: { queryType: 'invoice_summary', found: false } };
    const outstanding = +(n(inv.total_amount) - n(inv.paid_amount)).toFixed(2);
    const paymentRows = await this.paymentRepo.count({ where: { invoice_id: inv.id } });
    // ── R3A · التمييز بين تسوية تاريخية موثَّقة وسداد داخل PMS ────────────────
    // يُمنع منعاً باتاً توليد «تم الدفع بتاريخ كذا» لفاتورة بلا سجل سداد:
    // وقت التسوية غير معروف داخل النظام أصلاً، فذكره اختلاق.
    const basis = (inv as any).settlement_basis;
    const limitations: string[] = [];
    if (basis === 'pre_system_settled') {
      limitations.push(
        'الفاتورة مسجَّلة كتسوية تاريخية قبل PMS بموجب دفعة استيراد معتمدة من الإدارة. ' +
        'لا يوجد داخل النظام سند دفع تشغيلي لهذه التسوية، ولا تاريخ سداد. ' +
        'لا تُحتسب ضمن مدفوعات PMS ولا الحركة البنكية. Do not state a payment date for this invoice.',
      );
    } else if (basis === 'credit_note') {
      limitations.push(
        'هذا المستند إشعار دائن ضمن دفعة استيراد تاريخي: يخفّض التزاماً ولا يمثّل سداداً. ' +
        'Do not describe it as a payment.',
      );
    } else if (paymentRows === 0 && (inv.status === 'paid' || inv.approval_status === 'paid')) {
      // R3B: approval_status='paid' تعني «معتمد للصرف» — ليست دليل سداد إطلاقاً.
      limitations.push(
        'No actual payment record exists for this invoice inside PMS. ' +
        (inv.approval_status === 'paid'
          ? 'approval_status="paid" means APPROVED FOR PAYMENT, which is not evidence of payment. '
          : '') +
        'Do not state a payment date, bank reference or payment method: none exists in the system.',
      );
    }
    return {
      source: 'Invoices',
      facts: [
        { label: 'Invoice', value: inv.invoice_number },
        { label: 'Total', value: money(n(inv.total_amount), inv.currency) },
        { label: 'Paid (stored)', value: money(n(inv.paid_amount), inv.currency) },
        { label: 'Outstanding', value: money(outstanding, inv.currency) },
      ],
      limitations,
      actions: [{ label: `Open invoice ${inv.invoice_number}`, route: `${SCREEN.invoices}?q=${encodeURIComponent(inv.invoice_number)}` }],
      data: {
        queryType: 'invoice_summary', found: true,
        invoice_number: inv.invoice_number, supplier: inv.supplier?.name || null, vessel: inv.vessel?.name || null,
        po_number: (inv as any).purchase_order?.po_number || null, currency: inv.currency,
        total_amount: n(inv.total_amount), paid_amount: n(inv.paid_amount), outstanding,
        invoice_payment_status: inv.status,
        approval_status: inv.approval_status,
        approval_status_meaning: inv.approval_status === 'paid' ? 'APPROVED FOR PAYMENT - not evidence of payment' : null,
        data_origin: (inv as any).data_origin || null,
        settlement_basis: (inv as any).settlement_basis || null,
        actual_payment_transactions: paymentRows,
        note: 'Outstanding = total_amount - paid_amount (stored). approval_status, payment status, and actual payment transactions are distinct. ' +
              'settlement_basis=pre_system_settled means the invoice was settled before PMS existed: closed, zero outstanding, but NOT a PMS payment and with no known payment date.',
      },
    };
  }

  async getSupplierSummary(ctx: PermCtx, name: string): Promise<ToolResult> {
    const all = await this.loadInvoices();
    const today = startOfToday();
    const matches = all.filter((i) => (i.supplier?.name || '').toLowerCase().includes((name || '').toLowerCase()) && name);
    if (!name || matches.length === 0) {
      // ranking: supplier with highest outstanding per currency
      const bySup: Record<string, Invoice[]> = {};
      all.filter(invActive).forEach((i) => { const s = i.supplier?.name; if (s) (bySup[s] = bySup[s] || []).push(i); });
      const ranked = Object.entries(bySup).map(([sup, list]) => ({ sup, map: byCurrency(list, (i) => n(i.total_amount) - n(i.paid_amount), (i) => i.currency) }))
        .map((x) => ({ ...x, max: Math.max(0, ...Object.values(x.map)) })).sort((a, b) => b.max - a.max).slice(0, 5);
      return { source: 'Suppliers', facts: ranked.map((r) => ({ label: r.sup, value: ccyText(r.map) })), limitations: name ? [`No supplier matched "${name}"; showing top exposures.`] : [], actions: [{ label: 'Open suppliers', route: SCREEN.suppliers }], data: { queryType: 'supplier_ranking', top: ranked.map((r) => ({ supplier: r.sup, outstandingByCurrency: r.map })) } };
    }
    const supName = matches[0].supplier?.name || name;
    const supInv = all.filter((i) => (i.supplier?.name || '') === supName);
    const unpaid = supInv.filter(invActive);
    const outstanding = byCurrency(unpaid, (i) => n(i.total_amount) - n(i.paid_amount), (i) => i.currency);
    const overdue = unpaid.filter((i) => isOverdue(i, today)).length;
    return {
      source: 'Suppliers',
      facts: [{ label: 'Supplier', value: supName }, ...ccyFacts('Outstanding', outstanding), { label: 'Overdue invoices', value: String(overdue) }, { label: 'Invoices', value: String(supInv.length) }],
      limitations: [],
      actions: [{ label: `Open ${supName}`, route: `${SCREEN.suppliers}?q=${encodeURIComponent(supName)}` }],
      data: { queryType: 'supplier_summary', supplier: supName, outstandingByCurrency: outstanding, overdueInvoiceCount: overdue, invoiceCount: supInv.length },
    };
  }

  async getPaymentSummary(ctx: PermCtx, opts: { period?: string; supplier?: string } = {}): Promise<ToolResult> {
    // مدفوعات فعلية فقط من جدول المدفوعات
    const pays = await this.paymentRepo.find({ relations: { invoice: { supplier: true } } as any });
    let list = pays;
    if (opts.period === 'month') { const now = new Date(); const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`; list = list.filter((p) => String(p.payment_date).slice(0, 7) === ym); }
    if (opts.supplier) list = list.filter((p) => ((p.invoice as any)?.supplier?.name || '').toLowerCase().includes(opts.supplier!.toLowerCase()));
    const byCcy = byCurrency(list, (p) => n(p.amount), (p) => p.currency);
    const byMethod: Record<string, number> = {};
    list.forEach((p) => { byMethod[p.payment_method] = (byMethod[p.payment_method] || 0) + 1; });
    const top = [...list].sort((a, b) => n(b.amount) - n(a.amount)).slice(0, 8).map((p) => ({ reference: p.reference || null, invoice: (p.invoice as any)?.invoice_number || null, amount: n(p.amount), currency: p.currency, date: String(p.payment_date).slice(0, 10), method: p.payment_method }));
    return {
      source: 'Payments (actual transactions)',
      facts: [{ label: 'Actual payments', value: String(list.length) }, ...ccyFacts('Total paid', byCcy)],
      limitations: ['Actual payment transactions only (from Payments records) — not derived from invoice paid-status.'],
      actions: [{ label: 'Open payments', route: SCREEN.payments }],
      data: { queryType: 'payment_summary', count: list.length, totalByCurrency: byCcy, byMethod, top },
    };
  }

  async getVesselSummary(ctx: PermCtx, name?: string): Promise<ToolResult> {
    const all = await this.loadInvoices();
    const unpaid = all.filter(invActive);
    const byVes: Record<string, Invoice[]> = {};
    unpaid.forEach((i) => { const v = i.vessel?.name; if (v) (byVes[v] = byVes[v] || []).push(i); });
    let rows = Object.entries(byVes);
    if (name) rows = rows.filter(([v]) => v.toLowerCase().includes(name.toLowerCase()));
    const data = rows.map(([vessel, list]) => ({ vessel, outstandingByCurrency: byCurrency(list, (i) => n(i.total_amount) - n(i.paid_amount), (i) => i.currency), invoiceCount: list.length }))
      .sort((a, b) => Math.max(0, ...Object.values(b.outstandingByCurrency)) - Math.max(0, ...Object.values(a.outstandingByCurrency)));
    return {
      source: 'Vessels',
      facts: data.slice(0, 6).map((d) => ({ label: d.vessel, value: ccyText(d.outstandingByCurrency) })),
      limitations: ['Vessel figures shown are outstanding supplier costs (from invoices). Operational fleet profitability is partial / source-limited and is not a complete accounting P&L.'],
      actions: [{ label: 'Open vessels', route: SCREEN.vessels }, ...(ctx.can(SCREEN.reports) ? [{ label: 'Fleet report', route: SCREEN.reports }] : [])],
      data: { queryType: 'vessel_summary', vessels: data.slice(0, 10) },
    };
  }

  async getTaskAttention(ctx: PermCtx): Promise<ToolResult> {
    const today = startOfToday();
    const tasks = await this.taskRepo.find();
    const active = (t: Task) => t.status !== 'done' && t.status !== 'cancelled';
    const overdue = tasks.filter((t) => active(t) && parseDate(t.due_date) && parseDate(t.due_date)! < today);
    const dueToday = tasks.filter((t) => { const d = parseDate(t.due_date); return d && active(t) && d.getTime() === today.getTime(); });
    const urgentOverdue = overdue.filter((t) => t.priority === 'urgent');
    return {
      source: 'Tasks',
      facts: [{ label: 'Overdue tasks', value: String(overdue.length) }, { label: 'Due today', value: String(dueToday.length) }, { label: 'Urgent overdue', value: String(urgentOverdue.length) }],
      limitations: ['"My tasks" is not available: task owner is a free-text field, not linked to the authenticated user account.'],
      actions: [{ label: 'Open tasks', route: SCREEN.tasks }],
      data: {
        queryType: 'task_attention',
        overdue: overdue.slice(0, 8).map((t) => ({ title: t.title, owner: t.owner, priority: t.priority, due_date: t.due_date })),
        dueTodayCount: dueToday.length, urgentOverdueCount: urgentOverdue.length,
      },
    };
  }

  async getReportSummary(ctx: PermCtx): Promise<ToolResult> {
    // إعادة استخدام منطق الفواتير المعتمد (مستحقات الموردين لكل عملة)
    const out = await this.getOutstandingInvoices(ctx, 'overdue');
    return { ...out, source: 'Reports (payables)', data: { ...out.data, queryType: 'report_summary' } };
  }

  // ملخص إداري — أقسام مسموحة فقط
  async getManagementSummary(ctx: PermCtx): Promise<ToolResult> {
    const facts: { label: string; value: string }[] = [];
    const limitations: string[] = [];
    const actions: { label: string; route: string }[] = [];
    const data: any = { queryType: 'management_summary', sections: {} };
    if (ctx.can(SCREEN.invoices)) {
      const od = await this.getOutstandingInvoices(ctx, 'overdue');
      facts.push({ label: 'Overdue invoices', value: od.data.count }, ...ccyFacts('Overdue outstanding', od.data.outstandingByCurrency));
      actions.push({ label: 'Overdue invoices', route: SCREEN.invoices });
      data.sections.invoices = od.data;
    }
    if (ctx.can(SCREEN.payments)) {
      const pm = await this.getPaymentSummary(ctx, { period: 'month' });
      facts.push({ label: 'Actual payments (this month)', value: pm.data.count });
      data.sections.payments = pm.data;
    }
    if (ctx.can(SCREEN.tasks)) {
      const ta = await this.getTaskAttention(ctx);
      facts.push({ label: 'Overdue tasks', value: ta.data.overdue.length });
      actions.push({ label: 'Tasks', route: SCREEN.tasks });
      data.sections.tasks = ta.data;
    }
    if (ctx.can(SCREEN.vessels)) {
      const vs = await this.getVesselSummary(ctx);
      limitations.push('Fleet operational profitability is partial / source-limited.');
      data.sections.vessels = vs.data;
    }
    if (!Object.keys(data.sections).length) limitations.push('No permitted data categories are available for your account.');
    return { source: 'Management summary', facts, limitations, actions, data };
  }
}
