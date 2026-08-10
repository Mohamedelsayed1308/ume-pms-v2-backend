import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Invoice } from '../invoices/invoice.entity';
import { Payment } from '../payments/payment.entity';

/**
 * تدقيق السلامة المالية — قراءة فقط (SELECT).
 * لا يحتوي هذا الملف على أي INSERT / UPDATE / DELETE / ALTER / migration.
 * كل الأرقام تُحسب من سجلات الدفع الفعلية، ولا تُجمع عملتان مختلفتان أبداً.
 */

export type Severity = 'critical' | 'high' | 'medium' | 'low';

const TOL = 0.01; // تفاوت التقريب النقدي
const n = (v: any) => Number(v || 0);
const r2 = (v: number) => Math.round(v * 100) / 100;
const ccy = (c: any) => String(c || '').trim().toUpperCase() || 'UNKNOWN';

interface RuleMeta { key: string; title: string; severity: Severity; action: string; controlFlag?: boolean; }

const RULES: RuleMeta[] = [
  { key: 'paid_without_payments', title: 'فاتورة مُعلَّمة «مدفوعة» بلا أي سجل سداد', severity: 'critical', action: 'مراجعة يدوية: إمّا توثيق سند الدفع أو إعادة الحالة لغير مدفوعة' },
  { key: 'approval_paid_no_evidence', title: 'حالة الموافقة «paid» بلا دليل سداد كافٍ', severity: 'critical', action: 'فصل حالة الموافقة عن حالة السداد (قاعدة التصميم المستقبلية)' },
  { key: 'orphan_payment', title: 'سداد مرتبط بفاتورة غير موجودة', severity: 'critical', action: 'تحديد الفاتورة الصحيحة أو أرشفة السجل بعد المراجعة' },
  { key: 'overpaid', title: 'المبلغ المسدَّد المخزَّن أكبر من إجمالي الفاتورة', severity: 'critical', action: 'مراجعة سبب الزيادة (سداد مكرر أو خطأ إدخال)' },
  { key: 'negative_remaining', title: 'رصيد متبقٍ سالب على فاتورة موجبة', severity: 'critical', action: 'مطابقة السدادات مع الفاتورة' },
  { key: 'paid_amount_mismatch', title: 'المسدَّد المخزَّن لا يساوي مجموع السدادات الفعلية', severity: 'high', action: 'اعتماد مجموع السدادات كمصدر وحيد للحقيقة (إصدار لاحق)' },
  { key: 'payment_currency_mismatch', title: 'عملة السداد تخالف عملة الفاتورة', severity: 'high', action: 'تصحيح العملة أو توثيق سعر التحويل' },
  { key: 'negative_paid_amount', title: 'المسدَّد المخزَّن سالب على فاتورة موجبة', severity: 'high', action: 'مراجعة يدوية' },
  { key: 'duplicate_payment_high', title: 'سداد مكرر — ثقة عالية (نفس الفاتورة والمبلغ والعملة والمرجع)', severity: 'high', action: 'تأكيد مع البنك قبل أي تعديل' },
  { key: 'duplicate_payment_medium', title: 'سداد مكرر محتمل — ثقة متوسطة (نفس المبلغ والعملة والتاريخ)', severity: 'medium', action: 'مراجعة يدوية' },
  { key: 'status_inconsistent', title: 'حالة الفاتورة تخالف واقع السدادات', severity: 'medium', action: 'اشتقاق الحالة من السدادات (إصدار لاحق)' },
  { key: 'fully_paid_not_marked', title: 'السدادات تغطي الفاتورة بالكامل لكنها غير مُعلَّمة مدفوعة', severity: 'medium', action: 'مراجعة يدوية' },
  { key: 'negative_payment', title: 'سداد بمبلغ سالب', severity: 'medium', action: 'تصنيفه (مرتجع/تسوية) أو تصحيحه' },
  // مؤشّر رقابي لا خطأ مالي: التعامل بأكثر من عملة أمر مشروع.
  // يُصعَّد فقط عند وجود دليل خلط فعلي (سداد بعملة تخالف الفاتورة لدى نفس المورد).
  { key: 'supplier_currency_mixing', title: 'مورد يتعامل بأكثر من عملة (مؤشّر رقابي)', severity: 'low', controlFlag: true, action: 'التأكد أن كل عرض/تقرير يفصل العملات ولا يجمعها' },
  { key: 'duplicate_payment_low', title: 'سداد متشابه — ثقة منخفضة (نفس المبلغ والعملة فقط)', severity: 'low', action: 'مراجعة عند الحاجة' },
  { key: 'zero_payment', title: 'سداد بقيمة صفر', severity: 'low', action: 'حذف أو توثيق السبب' },
  { key: 'invoice_without_vessel', title: 'فاتورة بلا مركب', severity: 'low', action: 'استكمال البيانات لتحسين تقارير المراكب' },
];

export interface Finding {
  ruleKey: string; severity: Severity; issue: string;
  invoiceId: string | null; invoiceNumber: string | null;
  supplier: string | null; vessel: string | null;
  currency: string;
  invoiceTotal: number | null;
  storedPaidAmount: number | null;
  actualPaymentsSum: number | null;
  calculatedRemaining: number | null;
  status: string | null; approvalStatus: string | null;
  exposure: number;           // مقدار التضارب المالي بعملة الفاتورة
  paymentId?: string; paymentDate?: string; reference?: string; confidence?: string;
}

@Injectable()
export class AuditService {
  constructor(
    @InjectRepository(Invoice) private invoiceRepo: Repository<Invoice>,
    @InjectRepository(Payment) private paymentRepo: Repository<Payment>,
  ) {}

  async run() {
    // ── قراءة فقط ──
    const invoices = await this.invoiceRepo.find({
      relations: { supplier: true, vessel: true, payments: true },
      order: { invoice_date: 'DESC' },
    });
    const payments = await this.paymentRepo.find({ relations: { invoice: true } });

    const findings: Finding[] = [];
    const add = (f: Omit<Finding, 'severity' | 'issue'> & { ruleKey: string; severityOverride?: Severity }) => {
      const meta = RULES.find((r) => r.key === f.ruleKey)!;
      findings.push({ ...f, severity: f.severityOverride || meta.severity, issue: meta.title } as Finding);
    };

    // ══ فحوص على مستوى الفاتورة ══
    for (const inv of invoices) {
      const invCcy = ccy(inv.currency);
      const total = n(inv.total_amount);
      const stored = n(inv.paid_amount);
      const pays = inv.payments || [];

      // مجموع السدادات الفعلية — بعملة الفاتورة فقط (لا خلط عملات إطلاقاً)
      const samePays = pays.filter((p) => ccy(p.currency) === invCcy);
      const actual = r2(samePays.reduce((s, p) => s + n(p.amount), 0));
      const remaining = r2(total - actual);
      const isCreditNote = total < 0; // فاتورة سالبة = إشعار دائن/تسوية (تُصنَّف لا تُعالَج)

      const ctx = {
        invoiceId: inv.id, invoiceNumber: inv.invoice_number,
        supplier: inv.supplier?.name || null, vessel: inv.vessel?.name || null,
        currency: invCcy, invoiceTotal: r2(total), storedPaidAmount: r2(stored),
        actualPaymentsSum: actual, calculatedRemaining: remaining,
        status: inv.status || null, approvalStatus: inv.approval_status || null,
      };

      // 1) مُعلَّمة مدفوعة بلا أي سداد
      if (inv.status === 'paid' && pays.length === 0) {
        add({ ...ctx, ruleKey: 'paid_without_payments', exposure: r2(Math.abs(stored)) });
      }
      // 13) حالة الموافقة paid بلا دليل كافٍ
      if (inv.approval_status === 'paid' && actual + TOL < total) {
        add({ ...ctx, ruleKey: 'approval_paid_no_evidence', exposure: r2(total - actual) });
      }
      // 2) المسدَّد المخزَّن > الإجمالي
      if (!isCreditNote && stored > total + TOL) {
        add({ ...ctx, ruleKey: 'overpaid', exposure: r2(stored - total) });
      }
      // 4) متبقٍ سالب (يُستثنى الإشعار الدائن لأن سالبه متوقَّع)
      if (!isCreditNote && remaining < -TOL) {
        add({ ...ctx, ruleKey: 'negative_remaining', exposure: r2(Math.abs(remaining)) });
      }
      // 3) المسدَّد المخزَّن سالب
      if (!isCreditNote && stored < -TOL) {
        add({ ...ctx, ruleKey: 'negative_paid_amount', exposure: r2(Math.abs(stored)) });
      }
      // 8) المخزَّن ≠ مجموع السدادات الفعلية
      if (Math.abs(stored - actual) > TOL) {
        add({ ...ctx, ruleKey: 'paid_amount_mismatch', exposure: r2(Math.abs(stored - actual)) });
      }
      // 7) عملة سداد مخالفة
      for (const p of pays.filter((x) => ccy(x.currency) !== invCcy)) {
        add({ ...ctx, ruleKey: 'payment_currency_mismatch', exposure: r2(Math.abs(n(p.amount))),
          paymentId: p.id, paymentDate: String(p.payment_date || ''), reference: p.reference || undefined,
          currency: ccy(p.currency) });
      }
      // 9) حالة غير متسقة مع واقع السدادات
      const derived = actual <= TOL ? 'unpaid' : actual + TOL >= total ? 'paid' : 'partial';
      if (inv.status !== 'cancelled' && inv.status !== derived && !(inv.status === 'paid' && pays.length === 0)) {
        add({ ...ctx, ruleKey: 'status_inconsistent', exposure: 0 });
      }
      // 14) مغطّاة بالكامل لكن غير مُعلَّمة مدفوعة
      if (!isCreditNote && total > 0 && actual + TOL >= total && inv.status !== 'paid' && inv.status !== 'cancelled') {
        add({ ...ctx, ruleKey: 'fully_paid_not_marked', exposure: 0 });
      }
      // 12) بلا مركب
      if (!inv.vessel_id) {
        add({ ...ctx, ruleKey: 'invoice_without_vessel', exposure: 0 });
      }

      // 6) تكرار السدادات — تصنيف ثقة (لا يُعتبر أي تساوٍ تكراراً تلقائياً)
      const groups: Record<string, Payment[]> = {};
      for (const p of pays) {
        const k = `${r2(n(p.amount))}|${ccy(p.currency)}`;
        (groups[k] = groups[k] || []).push(p);
      }
      for (const list of Object.values(groups)) {
        if (list.length < 2) continue;
        const sorted = [...list].sort((a, b) => String(a.payment_date).localeCompare(String(b.payment_date)));
        for (let i = 1; i < sorted.length; i++) {
          const prev = sorted[i - 1], cur = sorted[i];
          const sameRef = !!(prev.reference && cur.reference && prev.reference.trim() === cur.reference.trim());
          const sameDate = String(prev.payment_date || '') === String(cur.payment_date || '');
          const key = sameRef ? 'duplicate_payment_high' : sameDate ? 'duplicate_payment_medium' : 'duplicate_payment_low';
          add({ ...ctx, ruleKey: key, exposure: r2(Math.abs(n(cur.amount))), currency: ccy(cur.currency),
            paymentId: cur.id, paymentDate: String(cur.payment_date || ''), reference: cur.reference || undefined,
            confidence: sameRef ? 'HIGH' : sameDate ? 'MEDIUM' : 'LOW' });
        }
      }
    }

    // ══ فحوص على مستوى السداد ══
    for (const p of payments) {
      const pCcy = ccy(p.currency);
      const base = {
        invoiceId: p.invoice?.id || null, invoiceNumber: p.invoice?.invoice_number || null,
        supplier: null, vessel: null, currency: pCcy,
        invoiceTotal: p.invoice ? r2(n(p.invoice.total_amount)) : null,
        storedPaidAmount: p.invoice ? r2(n(p.invoice.paid_amount)) : null,
        actualPaymentsSum: null, calculatedRemaining: null,
        status: p.invoice?.status || null, approvalStatus: p.invoice?.approval_status || null,
        paymentId: p.id, paymentDate: String(p.payment_date || ''), reference: p.reference || undefined,
      };
      // 5) سداد يتيم
      if (!p.invoice) add({ ...base, ruleKey: 'orphan_payment', exposure: r2(Math.abs(n(p.amount))) });
      // 10) سداد صفري
      if (Math.abs(n(p.amount)) <= TOL) add({ ...base, ruleKey: 'zero_payment', exposure: 0 });
      // 11) سداد سالب
      if (n(p.amount) < -TOL) add({ ...base, ruleKey: 'negative_payment', exposure: r2(Math.abs(n(p.amount))) });
    }

    // ══ 15) خلط العملات على مستوى المورد ══
    const bySupplier: Record<string, { name: string; ccys: Record<string, number> }> = {};
    for (const inv of invoices) {
      const sid = inv.supplier_id || 'unknown';
      const e = (bySupplier[sid] = bySupplier[sid] || { name: inv.supplier?.name || '—', ccys: {} });
      const c = ccy(inv.currency);
      e.ccys[c] = r2((e.ccys[c] || 0) + n(inv.total_amount));
    }
    const mixedSuppliers = Object.entries(bySupplier)
      .filter(([, v]) => Object.keys(v.ccys).length > 1)
      .map(([id, v]) => ({ supplierId: id, supplier: v.name, currencies: v.ccys }));
    // موردون لديهم دليل خلط فعلي (سداد بعملة تخالف عملة فاتورته) ⇒ تصعيد المؤشّر الرقابي
    const suppliersWithMismatch = new Set(
      findings.filter((f) => f.ruleKey === 'payment_currency_mismatch').map((f) => f.supplier),
    );
    for (const s of mixedSuppliers) {
      const escalated = suppliersWithMismatch.has(s.supplier);
      add({
        ruleKey: 'supplier_currency_mixing', invoiceId: null, invoiceNumber: null,
        supplier: s.supplier, vessel: null, currency: Object.keys(s.currencies).join(' + '),
        invoiceTotal: null, storedPaidAmount: null, actualPaymentsSum: null, calculatedRemaining: null,
        status: null, approvalStatus: null, exposure: 0,
        severityOverride: escalated ? 'high' : undefined,
      });
    }

    // ══ تصنيف المبالغ السالبة (عرض فقط — بلا أي تعديل) ══
    const classifyNegative = (text: string) => {
      const t = (text || '').toLowerCase();
      if (/credit\s*note|إشعار\s*دائن|cn-/.test(t)) return 'credit_note';
      if (/refund|مرتجع|استرداد/.test(t)) return 'refund';
      if (/adjust|تسوية|تعديل/.test(t)) return 'adjustment';
      return 'unclassified';
    };
    const negInvoices = invoices.filter((i) => n(i.total_amount) < 0);
    const negativeAmounts = {
      invoices: {
        total: negInvoices.length,
        byClass: negInvoices.reduce((acc: Record<string, number>, i) => {
          const k = classifyNegative(`${i.invoice_number} ${i.description || ''} ${i.notes || ''}`);
          acc[k] = (acc[k] || 0) + 1; return acc;
        }, {}),
        byCurrency: negInvoices.reduce((acc: Record<string, number>, i) => {
          const c = ccy(i.currency); acc[c] = r2((acc[c] || 0) + n(i.total_amount)); return acc;
        }, {}),
        samples: negInvoices.slice(0, 20).map((i) => ({
          invoiceNumber: i.invoice_number, supplier: i.supplier?.name || null, currency: ccy(i.currency),
          amount: r2(n(i.total_amount)), status: i.status,
          classification: classifyNegative(`${i.invoice_number} ${i.description || ''} ${i.notes || ''}`),
        })),
      },
      payments: {
        total: payments.filter((p) => n(p.amount) < 0).length,
        byCurrency: payments.filter((p) => n(p.amount) < 0).reduce((acc: Record<string, number>, p) => {
          const c = ccy(p.currency); acc[c] = r2((acc[c] || 0) + n(p.amount)); return acc;
        }, {}),
      },
    };

    // ══ التجميعات (لكل عملة على حدة — لا مجموع موحّد) ══
    // مجموع خام داخل قاعدة واحدة (لا تكرار داخلها).
    const expByCurrency = (list: Finding[]) => list.reduce((acc: Record<string, number>, f) => {
      if (!f.exposure) return acc;
      acc[f.currency] = r2((acc[f.currency] || 0) + f.exposure); return acc;
    }, {});

    // تعرُّض صافٍ بلا ازدواج: الفاتورة الواحدة قد تُطلق عدة قواعد لنفس المال،
    // فنأخذ أكبر تعرُّض لكل (فاتورة × عملة) بدل جمع القواعد فوق بعضها.
    const expDeduped = (list: Finding[]) => {
      const max: Record<string, number> = {};
      for (const f of list) {
        if (!f.exposure) continue;
        const k = `${f.invoiceId || f.paymentId || 'x'}|${f.currency}`;
        max[k] = Math.max(max[k] || 0, f.exposure);
      }
      return Object.entries(max).reduce((acc: Record<string, number>, [k, v]) => {
        const c = k.split('|')[1];
        acc[c] = r2((acc[c] || 0) + v); return acc;
      }, {});
    };

    const rules = RULES.map((meta) => {
      const list = findings.filter((f) => f.ruleKey === meta.key);
      return {
        ...meta, count: list.length,
        exposureByCurrency: expDeduped(list),        // صافٍ
        exposureByCurrencyRaw: expByCurrency(list),  // خام (تشخيصي)
        escalatedCount: list.filter((f) => f.severity !== meta.severity).length,
      };
    }).filter((r) => r.count > 0);

    const bySeverity = (['critical', 'high', 'medium', 'low'] as Severity[]).reduce((acc: any, s) => {
      const list = findings.filter((f) => f.severity === s);
      acc[s] = { count: list.length, exposureByCurrency: expDeduped(list) };
      return acc;
    }, {});

    const affectedInvoices = new Set(findings.filter((f) => f.invoiceId).map((f) => f.invoiceId));
    const affectedPayments = new Set(findings.filter((f) => f.paymentId).map((f) => f.paymentId));

    // أعلى التعرّضات — مجمَّعة لكل (فاتورة × عملة): تعرُّض صافٍ واحد + كل القواعد التي أُطلقت
    const sevRank: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3 };
    const expoMap: Record<string, any> = {};
    for (const f of findings) {
      const k = `${f.invoiceId || f.paymentId || 'x'}|${f.currency}`;
      const e = (expoMap[k] = expoMap[k] || {
        invoiceId: f.invoiceId, invoiceNumber: f.invoiceNumber, supplier: f.supplier, vessel: f.vessel,
        currency: f.currency, invoiceTotal: f.invoiceTotal, storedPaidAmount: f.storedPaidAmount,
        actualPaymentsSum: f.actualPaymentsSum, calculatedRemaining: f.calculatedRemaining,
        difference: f.storedPaidAmount != null && f.actualPaymentsSum != null ? r2(f.storedPaidAmount - f.actualPaymentsSum) : null,
        status: f.status, approvalStatus: f.approvalStatus,
        rulesTriggered: [] as string[], netExposure: 0, severity: 'low' as Severity,
      });
      if (!e.rulesTriggered.includes(f.issue)) e.rulesTriggered.push(f.issue);
      e.netExposure = Math.max(e.netExposure, f.exposure);   // بلا تكرار
      if (sevRank[f.severity] < sevRank[e.severity]) e.severity = f.severity;
    }
    const topExposures = Object.values(expoMap)
      .filter((e: any) => e.netExposure > 0)
      .sort((a: any, b: any) => b.netExposure - a.netExposure || sevRank[a.severity] - sevRank[b.severity])
      .slice(0, 20);

    const groupCount = (key: 'supplier' | 'vessel' | 'currency') =>
      findings.reduce((acc: Record<string, { count: number; exposureByCurrency: Record<string, number> }>, f) => {
        const k = (f as any)[key] || '—';
        const e = (acc[k] = acc[k] || { count: 0, exposureByCurrency: {} });
        e.count++;
        if (f.exposure) e.exposureByCurrency[f.currency] = r2((e.exposureByCurrency[f.currency] || 0) + f.exposure);
        return acc;
      }, {});

    return {
      mode: 'read-only',
      generated_at: new Date().toISOString(),
      summary: {
        invoicesScanned: invoices.length,
        paymentsScanned: payments.length,
        invoicesWithDiscrepancies: affectedInvoices.size,
        paymentsWithDiscrepancies: affectedPayments.size,
        totalFindings: findings.length,
        // صافٍ بلا ازدواج — أكبر تعرُّض لكل فاتورة/عملة
        exposureByCurrency: expDeduped(findings),
        // خام (مجموع كل القواعد) — للمقارنة فقط، قد يحتوي ازدواجاً
        exposureByCurrencyRaw: expByCurrency(findings),
        bySeverity,
      },
      rules,
      findings,
      topExposures,
      breakdown: { bySupplier: groupCount('supplier'), byVessel: groupCount('vessel'), byCurrency: groupCount('currency') },
      negativeAmounts,
      mixedCurrencySuppliers: mixedSuppliers,
      notes: [
        'مجموع السدادات الفعلية يُحسب من سجلات الدفع فقط، وبعملة الفاتورة حصراً.',
        'لا تُجمع عملتان مختلفتان في أي إجمالي.',
        'الفواتير السالبة (إشعارات دائنة) مستثناة من فحوص «الزيادة في السداد» و«المتبقي السالب» لأن سالبها متوقَّع.',
        'التدقيق للقراءة فقط ولم يُعدِّل أي سجل.',
      ],
    };
  }
}
