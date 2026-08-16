import { Injectable, BadRequestException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AccountingService, CreateEntryDto } from '../accounting.service';
import { round2, EUR } from '../accounting-posting';
import { splitHireRevenue, summariseCutoff } from '../revenue-cutoff';
import { evaluateAccrualEligibility, AccrualCategory } from '../../receipts/receipt-eligibility';
import { buildTwoSidedLines, buildSettlementLines, assertSettleable, BridgeDims } from './accounting-bridge.logic';
import { planDepreciation, assertWithinCarryingAmount, monthsBetween } from './depreciation.logic';
import { monthsDue } from './depreciation-catchup.logic';
import { planMonth, amortizationMonthsDue, type PrepaidSchedule } from './amortization.logic';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * جسر المستندات إلى القيود
 *
 * يحوّل فاتورة أو دفعة أو مشارطة إلى **مسوّدة قيد** — ولا يُرحّل. الترحيل يبقى
 * فعلاً منفصلاً على شاشته، فمن يُعِدّ القيد لا يُرحّله بالضرورة.
 *
 * والجسر **لا يخترع تصنيفاً محاسبياً**: حساب المصروف يأتي من الطالب. تخمينه من
 * نصّ الفاتورة يُنتج تصنيفاً لا يُدافَع عنه، وخطؤه لا يُكتشف إلا بعد الترحيل
 * حيث لا تعديل.
 *
 * ما يفعله بدلاً من التخمين: يتحقّق من الأهلية · يجد سعر الصرف المعتمَد لتاريخ
 * المعاملة · يقفل الالتزام بسعره الدفتري · يحسب فرق الصرف الحقيقي · ويمنع
 * الازدواج بمفتاح المصدر.
 * ═══════════════════════════════════════════════════════════════════════════
 */
@Injectable()
export class AccountingBridgeService {
  constructor(
    @InjectDataSource() private ds: DataSource,
    private accounting: AccountingService,
  ) {}

  // ── أدوات ─────────────────────────────────────────────────────────────────

  private async entity(id: string) {
    const [e] = await this.ds.query('SELECT * FROM legal_entities WHERE id = $1', [id]);
    if (!e) throw new NotFoundException('الكيان القانوني غير موجود');
    return e;
  }

  /** حساب بدوره — والدور مُلزِم: لا يُخمَّن الحساب من رمزه. */
  private async byRole(entityId: string, role: string) {
    const [a] = await this.ds.query(
      'SELECT * FROM accounting_accounts WHERE legal_entity_id = $1 AND system_role = $2 AND is_active',
      [entityId, role]);
    if (!a) {
      throw new UnprocessableEntityException(
        `لا حساب مُسنَد للدور ${role} في هذا الكيان — أسنده أولاً في دليل الحسابات`);
    }
    return a;
  }

  private async accountById(entityId: string, id: string, label: string) {
    const [a] = await this.ds.query(
      'SELECT * FROM accounting_accounts WHERE id = $1 AND legal_entity_id = $2', [id, entityId]);
    if (!a) throw new BadRequestException(`${label}: الحساب غير موجود في هذا الكيان`);
    if (!a.is_postable) throw new UnprocessableEntityException(`${label}: حساب تجميعي لا يقبل الترحيل`);
    if (!a.is_active) throw new UnprocessableEntityException(`${label}: الحساب غير نشط`);
    return a;
  }

  /**
   * سعر الصرف المعتمَد لتاريخ المعاملة — أو أحدث سعر **سابق** لها.
   *
   * السعر اللاحق للتاريخ يعني تقييماً بمعلومة لم تكن متاحة وقت العملية، والمحرّك
   * يرفضه أصلاً. فيُختار هنا الأحدث ضمن ما هو متاح فعلاً في حينه.
   */
  private async fxFor(entityId: string, currency: string, onDate: string) {
    if (currency.toUpperCase() === EUR) return null;
    const rows = await this.ds.query(
      `SELECT * FROM accounting_fx_rates
        WHERE legal_entity_id = $1 AND currency_from = $2 AND currency_to = 'EUR'
          AND rate_date <= $3::date AND approved_by IS NOT NULL
        ORDER BY rate_date DESC LIMIT 1`,
      [entityId, currency.toUpperCase(), onDate]);
    if (!rows.length) {
      throw new UnprocessableEntityException(
        `لا سعر صرف معتمَد لـ${currency.toUpperCase()}/EUR في ${onDate} أو قبله — أضفه واعتمده أولاً`);
    }
    return rows[0];
  }

  private async journalByCode(entityId: string, code: string) {
    const [j] = await this.ds.query(
      'SELECT * FROM journals WHERE legal_entity_id = $1 AND code = $2 AND is_active', [entityId, code]);
    if (!j) throw new UnprocessableEntityException(`الدفتر ${code} غير معرَّف في هذا الكيان`);
    return j;
  }

  private async supplierDefault(entityId: string, supplierId: string) {
    const [d] = await this.ds.query(
      'SELECT * FROM supplier_accounting_defaults WHERE legal_entity_id = $1 AND supplier_id = $2',
      [entityId, supplierId]);
    return d ?? null;
  }

  /** قراءة وكتابة افتراضيات المورّد — إعدادٌ لا حركة. */
  listSupplierDefaults(entityId: string) {
    return this.ds.query(
      `SELECT d.*, s.name AS supplier_name, a.code AS account_code, a.name AS account_name
         FROM supplier_accounting_defaults d
         JOIN suppliers s ON s.id = d.supplier_id
         JOIN accounting_accounts a ON a.id = d.debit_account_id
        WHERE d.legal_entity_id = $1
        ORDER BY s.name`, [entityId]);
  }

  async setSupplierDefault(body: any, userId: string | null) {
    const entityId = String(body?.legal_entity_id || '');
    await this.entity(entityId);
    const supplierId = String(body?.supplier_id || '');
    const cat = String(body?.accrual_category || '').toUpperCase();
    if (cat !== 'GOODS' && cat !== 'PERIOD_SERVICE') {
      throw new BadRequestException('accrual_category يجب أن تكون GOODS أو PERIOD_SERVICE');
    }
    const acct = await this.accountById(entityId, String(body?.debit_account_id || ''), 'حساب المصروف');
    if (acct.account_type !== 'expense' && acct.account_type !== 'asset') {
      throw new UnprocessableEntityException(
        `حساب ${acct.code} تصنيفه ${acct.account_type} — الافتراضي يكون مصروفاً أو أصلاً`);
    }
    const [row] = await this.ds.query(
      `INSERT INTO supplier_accounting_defaults
         (legal_entity_id, supplier_id, debit_account_id, accrual_category, notes, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (legal_entity_id, supplier_id) DO UPDATE
         SET debit_account_id = EXCLUDED.debit_account_id,
             accrual_category = EXCLUDED.accrual_category,
             notes = EXCLUDED.notes, updated_by = EXCLUDED.updated_by, updated_at = now()
       RETURNING *`,
      [entityId, supplierId, acct.id, cat, body?.notes ?? null, userId]);
    return row;
  }

  /**
   * نطاق الدفتر — المركب يتبع شركة، والشركة تتبع كياناً محاسبياً.
   *
   * دفتر Sivamar يخصّ مراكبها وحدها. وبقية مراكب الأسطول لشركات أخرى، فترحيل
   * فاتورة إحداها هنا يخلط ذممَ كيانين — وهو خطأ لا يُكتشف إلا بعد الترحيل حيث
   * لا تعديل. فيُمنع عند الباب.
   *
   * والفاتورة بلا مركب لا تُفترض داخل النطاق: الصمت استبعاد لا شمول.
   */
  private async assertInScope(entityId: string, vesselId: string | null, label: string) {
    if (!vesselId) {
      throw new UnprocessableEntityException(
        `${label}: بلا مركب — لا يمكن نسبتها لكيان محاسبي. أسند المركب أولاً.`);
    }
    const [row] = await this.ds.query(
      `SELECT v.name AS vessel, sc.name AS company, sc.legal_entity_id
         FROM vessels v
         LEFT JOIN shipping_companies sc ON sc.id = v.shipping_company_id
        WHERE v.id = $1`, [vesselId]);
    if (!row) throw new UnprocessableEntityException(`${label}: المركب غير موجود`);
    if (!row.legal_entity_id) {
      throw new UnprocessableEntityException(
        `${label}: مركب ${row.vessel} تابع لـ${row.company ?? 'شركة غير محدَّدة'} وهي غير مربوطة بكيان محاسبي — خارج نطاق الدفتر`);
    }
    if (row.legal_entity_id !== entityId) {
      throw new UnprocessableEntityException(
        `${label}: مركب ${row.vessel} يخصّ كياناً محاسبياً آخر (${row.company}) — لا يُرحَّل في هذا الدفتر`);
    }
  }

  /** القيد القائم لهذا المصدر — يمنع الازدواج قبل أن يصطدم بفهرس قاعدة البيانات. */
  private async existingEntry(entityId: string, event: string, srcType: string, srcId: string) {
    const [e] = await this.ds.query(
      `SELECT id, entry_no, status FROM journal_entries
        WHERE legal_entity_id = $1 AND accounting_event_type = $2
          AND source_type = $3 AND source_id = $4 AND status <> 'void' LIMIT 1`,
      [entityId, event, srcType, srcId]);
    return e ?? null;
  }

  /**
   * الفواتير التي تنتظر قيداً — بحسابها المقترح وأهليّتها محسوبةً.
   *
   * تُعرَض **كلها** لا المؤهَّلة وحدها: إخفاء غير المؤهَّلة يجعل السبب مجهولاً،
   * فيظنّ القارئ أن الفاتورة ضاعت لا أنها تنتظر دليلاً. والسبب يُرافق كل صفّ.
   */
  async postableInvoices(entityId: string) {
    await this.entity(entityId);
    const rows = await this.ds.query(
      `SELECT i.id, i.invoice_number, i.currency, i.total_amount, i.invoice_date,
              i.approval_status, i.supplier_id, i.vessel_id,
              s.name AS supplier_name, v.name AS vessel_name,
              (SELECT COUNT(*)::int FROM goods_service_receipts r WHERE r.invoice_id = i.id) AS receipt_count,
              d.debit_account_id, d.accrual_category,
              a.code AS account_code, a.name AS account_name
         FROM invoices i
         JOIN vessels v ON v.id = i.vessel_id
         JOIN shipping_companies sc ON sc.id = v.shipping_company_id
         LEFT JOIN suppliers s ON s.id = i.supplier_id
         LEFT JOIN supplier_accounting_defaults d
                ON d.supplier_id = i.supplier_id AND d.legal_entity_id = $1
         LEFT JOIN accounting_accounts a ON a.id = d.debit_account_id
        WHERE sc.legal_entity_id = $1
          AND NOT EXISTS (
                SELECT 1 FROM journal_entries je
                 WHERE je.source_type = 'invoice' AND je.source_id = i.id AND je.status <> 'void')
        ORDER BY i.invoice_date DESC NULLS LAST`,
      [entityId]);

    const receipts = await this.ds.query(
      `SELECT r.invoice_id, r.receipt_type, r.received_date
         FROM goods_service_receipts r
        WHERE r.invoice_id = ANY($1::uuid[])`,
      [rows.map((r: any) => r.id)]);
    const byInvoice = new Map<string, any[]>();
    for (const r of receipts) byInvoice.set(r.invoice_id, [...(byInvoice.get(r.invoice_id) ?? []), r]);

    return rows.map((r: any) => {
      // بلا تصنيف محفوظ تُفترض سلعةً — وهو الافتراض المتشدّد: السلعة تحتاج دليلاً
      // والخدمة لا. فالتساهل يأتي بقرار لا بغياب إعداد.
      const category: AccrualCategory = (r.accrual_category as AccrualCategory) ?? 'GOODS';
      const verdict = evaluateAccrualEligibility({
        category,
        approval_status: r.approval_status,
        receipts: byInvoice.get(r.id) ?? [],
      });
      return { ...r, assumed_category: category, eligible: verdict.eligible, reason: verdict.reason };
    });
  }

  // ── فاتورة مورد ← استحقاق ─────────────────────────────────────────────────

  async postSupplierInvoice(invoiceId: string, body: any, userId: string | null) {
    const [inv] = await this.ds.query('SELECT * FROM invoices WHERE id = $1', [invoiceId]);
    if (!inv) throw new NotFoundException('الفاتورة غير موجودة');

    const entityId = String(body?.legal_entity_id || '');
    await this.entity(entityId);

    await this.assertInScope(entityId, inv.vessel_id ?? null, `الفاتورة ${inv.invoice_number}`);

    const dup = await this.existingEntry(entityId, 'invoice_accrual', 'invoice', invoiceId);
    if (dup) {
      throw new UnprocessableEntityException(
        `للفاتورة قيد استحقاق بالفعل (${dup.entry_no ?? 'مسوّدة'} · ${dup.status}) — لا تُستحقّ مرتين`);
    }

    // افتراضي المورّد يملأ ما لم يُعطَ — والطلب يعلو عليه دائماً، فالمُعِدّ هو
    // من يوقّع على التصنيف لا صفٌّ في جدول إعدادات.
    const preset = inv.supplier_id ? await this.supplierDefault(entityId, inv.supplier_id) : null;

    // الأهلية أولاً: الفاتورة تُثبت المطالبة لا الاستلام.
    const category = String(body?.category || preset?.accrual_category || '').toUpperCase() as AccrualCategory;
    if (category !== 'GOODS' && category !== 'PERIOD_SERVICE') {
      throw new BadRequestException(
        'category يجب أن تكون GOODS أو PERIOD_SERVICE — لا في الطلب ولا في افتراضي المورّد');
    }
    const receipts = await this.ds.query(
      'SELECT receipt_type, received_date FROM goods_service_receipts WHERE invoice_id = $1', [invoiceId]);
    const verdict = evaluateAccrualEligibility({
      category, approval_status: inv.approval_status, receipts,
      service_period_end: body?.service_period_end ?? null,
      as_of: body?.as_of ?? undefined,
    });
    if (!verdict.eligible) {
      throw new UnprocessableEntityException(`غير مؤهَّلة للاستحقاق — ${verdict.reason}`);
    }

    const debitId = String(body?.debit_account_id || preset?.debit_account_id || '');
    if (!debitId) {
      throw new BadRequestException(
        'حساب المصروف مطلوب — أرسله في الطلب أو أسند افتراضياً لهذا المورّد');
    }
    const debitAccount = await this.accountById(entityId, debitId, 'حساب المدين');
    const payable = body?.payable_account_id
      ? await this.accountById(entityId, body.payable_account_id, 'حساب الدائن')
      : await this.byRole(entityId, 'AP_CONTROL');

    const date = String(body?.accounting_date || inv.invoice_date);
    const fx = await this.fxFor(entityId, inv.currency, date);
    const dims: BridgeDims = { vessel_id: inv.vessel_id ?? null, supplier_id: inv.supplier_id ?? null };

    const dto: CreateEntryDto = {
      legal_entity_id: entityId,
      journal_id: (await this.journalByCode(entityId, body?.journal_code || 'PJ')).id,
      accounting_date: date,
      source_document_date: inv.invoice_date,
      description: body?.description || `استحقاق فاتورة مورد ${inv.invoice_number}`,
      reference: inv.invoice_number,
      accounting_event_type: 'invoice_accrual',
      source_type: 'invoice', source_id: invoiceId, source_reference: inv.invoice_number,
      backdated_reason: body?.backdated_reason ?? null,
      lines: buildTwoSidedLines({
        debitAccountId: debitAccount.id, creditAccountId: payable.id,
        amount: Number(inv.total_amount), currency: inv.currency,
        fxRateId: fx?.id ?? null, dims,
        debitDescription: `${debitAccount.name} — ${inv.invoice_number}`,
        creditDescription: `دائنون — ${inv.invoice_number}`,
      }),
    };

    const entry = await this.accounting.createDraft(dto, userId);
    return { eligibility: verdict, fx_rate_used: fx ? { date: fx.rate_date, rate: fx.rate, source: fx.source } : null, entry };
  }

  // ── دفعة ← تسوية مع فرق الصرف ─────────────────────────────────────────────

  async postSupplierPayment(paymentId: string, body: any, userId: string | null) {
    const [pay] = await this.ds.query('SELECT * FROM payments WHERE id = $1', [paymentId]);
    if (!pay) throw new NotFoundException('الدفعة غير موجودة');
    const [inv] = await this.ds.query('SELECT * FROM invoices WHERE id = $1', [pay.invoice_id]);
    if (!inv) throw new NotFoundException('فاتورة الدفعة غير موجودة');

    const entityId = String(body?.legal_entity_id || '');
    await this.entity(entityId);

    await this.assertInScope(entityId, inv.vessel_id ?? null, `دفعة الفاتورة ${inv.invoice_number}`);

    const dup = await this.existingEntry(entityId, 'payment_settlement', 'payment', paymentId);
    if (dup) {
      throw new UnprocessableEntityException(
        `للدفعة قيد تسوية بالفعل (${dup.entry_no ?? 'مسوّدة'} · ${dup.status}) — لا تُسوّى مرتين`);
    }

    // الالتزام يجب أن يكون مُثبَتاً أولاً — لا يُسدَّد دائنٌ لم يُقيَّد.
    const accrual = await this.existingEntry(entityId, 'invoice_accrual', 'invoice', pay.invoice_id);
    if (!accrual || accrual.status !== 'posted') {
      throw new UnprocessableEntityException(
        'لا قيد استحقاق مُرحَّل لهذه الفاتورة — أثبت الالتزام قبل تسويته');
    }

    const payable = body?.payable_account_id
      ? await this.accountById(entityId, body.payable_account_id, 'حساب الدائن')
      : await this.byRole(entityId, 'AP_CONTROL');

    // السعر الدفتري يُقرأ من سطر الدائن في قيد الاستحقاق نفسه — لا يُعاد حسابه.
    const [apLine] = await this.ds.query(
      `SELECT jl.fx_rate, jl.fx_rate_id, jl.transaction_currency
         FROM journal_lines jl WHERE jl.entry_id = $1 AND jl.account_id = $2 AND jl.credit > 0 LIMIT 1`,
      [accrual.id, payable.id]);
    if (!apLine) throw new UnprocessableEntityException('تعذّر إيجاد سطر الدائن في قيد الاستحقاق');
    if (String(apLine.transaction_currency).toUpperCase() !== String(pay.currency).toUpperCase()) {
      throw new UnprocessableEntityException(
        `عملة السداد (${pay.currency}) تخالف عملة الالتزام (${apLine.transaction_currency})`);
    }

    const settled = await this.ds.query(
      `SELECT COALESCE(SUM(jl.debit),0) AS s FROM journal_lines jl
         JOIN journal_entries je ON je.id = jl.entry_id
        WHERE je.legal_entity_id = $1 AND je.accounting_event_type = 'payment_settlement'
          AND je.status IN ('posted','draft') AND jl.account_id = $2
          AND je.source_reference = $3`,
      [entityId, payable.id, inv.invoice_number]);
    assertSettleable(Number(inv.total_amount), Number(settled[0]?.s ?? 0), Number(pay.amount));

    const bank = await this.accountById(entityId, String(body?.bank_account_id || ''), 'الحساب البنكي');
    const gain = await this.byRole(entityId, 'REALIZED_FX_GAIN');
    const loss = await this.byRole(entityId, 'REALIZED_FX_LOSS');

    const date = String(body?.accounting_date || pay.payment_date);
    const settlementFx = await this.fxFor(entityId, pay.currency, date);

    const built = buildSettlementLines({
      amount: Number(pay.amount), currency: pay.currency,
      carrying: { fxRateId: apLine.fx_rate_id, rate: Number(apLine.fx_rate) },
      settlement: { fxRateId: settlementFx?.id ?? null, rate: settlementFx ? Number(settlementFx.rate) : 1 },
      accounts: { payableId: payable.id, bankId: bank.id, fxGainId: gain.id, fxLossId: loss.id },
      dims: { vessel_id: inv.vessel_id ?? null, supplier_id: inv.supplier_id ?? null },
    });

    const dto: CreateEntryDto = {
      legal_entity_id: entityId,
      journal_id: (await this.journalByCode(entityId, body?.journal_code || 'BJ')).id,
      accounting_date: date, source_document_date: pay.payment_date,
      description: body?.description || `سداد فاتورة ${inv.invoice_number} من ${bank.name}`,
      reference: inv.invoice_number,
      accounting_event_type: 'payment_settlement',
      source_type: 'payment', source_id: paymentId, source_reference: inv.invoice_number,
      backdated_reason: body?.backdated_reason ?? null,
      lines: built.lines,
    };

    const entry = await this.accounting.createDraft(dto, userId);
    return {
      carrying_eur: built.carrying_eur, settlement_eur: built.settlement_eur,
      fx_difference_eur: built.fx_difference_eur,
      fx_note: built.fx_difference_eur === 0
        ? 'السعران متساويان — لا فرق ولا حركة على حسابي الصرف'
        : (built.fx_difference_eur > 0 ? 'مكسب صرف محقَّق' : 'خسارة صرف محقَّقة'),
      entry,
    };
  }

  // ── مشارطة ← إيراد مؤجَّل ─────────────────────────────────────────────────

  async postHireInvoice(hireId: string, body: any, userId: string | null) {
    const [h] = await this.ds.query('SELECT * FROM hire_invoices WHERE id = $1', [hireId]);
    if (!h) throw new NotFoundException('فاتورة الإيجار غير موجودة');

    const entityId = String(body?.legal_entity_id || '');
    await this.entity(entityId);

    await this.assertInScope(entityId, h.vessel_id ?? null, `مشارطة ${h.invoice_number}`);

    const dup = await this.existingEntry(entityId, 'invoice_accrual', 'hire_invoice', hireId);
    if (dup) {
      throw new UnprocessableEntityException(
        `للمشارطة قيد بالفعل (${dup.entry_no ?? 'مسوّدة'} · ${dup.status})`);
    }

    // الذمة تذهب حيث يقول الطالب: الطرف المرتبط قرار محاسبي لا استنتاج من اسم.
    const receivable = await this.accountById(entityId, String(body?.receivable_account_id || ''), 'حساب الذمم');
    const deferred = body?.deferred_account_id
      ? await this.accountById(entityId, body.deferred_account_id, 'حساب الإيراد المؤجَّل')
      : await this.byRole(entityId, 'DEFERRED_REVENUE');

    const date = String(body?.accounting_date || h.invoice_date);
    const fx = await this.fxFor(entityId, h.currency, date);

    const dto: CreateEntryDto = {
      legal_entity_id: entityId,
      journal_id: (await this.journalByCode(entityId, body?.journal_code || 'GJ')).id,
      accounting_date: date, source_document_date: h.invoice_date,
      description: body?.description || `فاتورة إيجار ${h.invoice_number} — إلى الإيراد المؤجَّل`,
      reference: h.invoice_number,
      accounting_event_type: 'invoice_accrual',
      source_type: 'hire_invoice', source_id: hireId, source_reference: h.invoice_number,
      backdated_reason: body?.backdated_reason ?? null,
      lines: buildTwoSidedLines({
        debitAccountId: receivable.id, creditAccountId: deferred.id,
        amount: Number(h.total_amount), currency: h.currency, fxRateId: fx?.id ?? null,
        dims: { vessel_id: h.vessel_id ?? null, customer_id: h.customer_id ?? null },
        debitDescription: `${receivable.name} — ${h.invoice_number}`,
        creditDescription: `إيراد إيجار غير مكتسَب — ${h.invoice_number}`,
      }),
    };

    return { entry: await this.accounting.createDraft(dto, userId) };
  }

  // ── الإهلاك الشهري ────────────────────────────────────────────────────────

  /**
   * قيد إهلاك لكل شهر في المدى — لا قيد واحد مجمَّع.
   *
   * الإهلاك مصروف **شهر بعينه**. جمعه في قيد واحد يُحمّل شهراً واحداً ما استحقّته
   * سبعة، فتكذب قائمة دخل كل شهر منها.
   *
   * والشهر المُهلَك سلفاً يُتخطَّى بصمت لا يُرفض المدى كلّه: تشغيلها ثانيةً بعد
   * إضافة شهر جديد يجب أن يعمل، لا أن يصطدم بما نجح سابقاً.
   */
  async postDepreciation(body: any, userId: string | null) {
    const entityId = String(body?.legal_entity_id || '');
    const entity = await this.entity(entityId);

    const vesselId = String(body?.vessel_id || '');
    await this.assertInScope(entityId, vesselId || null, 'الإهلاك');

    const expense = body?.expense_account_id
      ? await this.accountById(entityId, body.expense_account_id, 'حساب مصروف الإهلاك')
      : await this.byRole(entityId, 'DEPRECIATION_EXPENSE');
    const accumulated = body?.accumulated_account_id
      ? await this.accountById(entityId, body.accumulated_account_id, 'حساب مجمع الإهلاك')
      : await this.byRole(entityId, 'ACCUMULATED_DEPRECIATION');
    const costAccount = body?.cost_account_id
      ? await this.accountById(entityId, body.cost_account_id, 'حساب تكلفة الأصل')
      : await this.byRole(entityId, 'VESSEL_COST');

    const plan = planDepreciation({
      vesselId,
      from: String(body?.from_month || ''),
      to: String(body?.to_month || ''),
      monthlyAmount: Number(body?.monthly_amount),
      namespace: entityId,
    });

    // الحدّ يُقرأ من الدفتر لا من سجل أصول لا وجود له.
    const [bal] = await this.ds.query(
      `SELECT
         COALESCE(SUM(l.debit_eur)  FILTER (WHERE l.account_id = $2), 0)
       - COALESCE(SUM(l.credit_eur) FILTER (WHERE l.account_id = $2), 0) AS cost,
         COALESCE(SUM(l.credit_eur) FILTER (WHERE l.account_id = $3), 0)
       - COALESCE(SUM(l.debit_eur)  FILTER (WHERE l.account_id = $3), 0) AS accumulated
       FROM journal_lines l
       JOIN journal_entries e ON e.id = l.entry_id
      WHERE e.legal_entity_id = $1 AND e.status IN ('posted','reversed')`,
      [entityId, costAccount.id, accumulated.id]);

    const totalCharge = round2(plan.reduce((a, p) => a + p.amount, 0));
    assertWithinCarryingAmount({
      costEur: Number(bal?.cost ?? 0),
      accumulatedEur: Number(bal?.accumulated ?? 0),
      chargeEur: totalCharge,
    });

    const journalId = (await this.journalByCode(entityId, body?.journal_code || 'GJ')).id;
    const created: any[] = [];
    const skipped: string[] = [];

    for (const m of plan) {
      const dup = await this.existingEntry(entityId, 'depreciation', 'depreciation', m.source_id);
      if (dup) { skipped.push(`${m.month} (${dup.entry_no ?? 'مسوّدة'})`); continue; }

      const dto: CreateEntryDto = {
        legal_entity_id: entityId, journal_id: journalId,
        accounting_date: m.accounting_date, source_document_date: m.accounting_date,
        description: body?.description
          ? `${body.description} — ${m.month}`
          : `إهلاك ${m.month} — قسط شهري`,
        reference: m.source_reference,
        accounting_event_type: 'depreciation',
        source_type: 'depreciation', source_id: m.source_id, source_reference: m.source_reference,
        backdated_reason: body?.backdated_reason ?? null,
        lines: buildTwoSidedLines({
          debitAccountId: expense.id, creditAccountId: accumulated.id,
          amount: m.amount, currency: entity.functional_currency, fxRateId: null,
          dims: { vessel_id: vesselId },
          debitDescription: `${expense.name} — ${m.month}`,
          creditDescription: `${accumulated.name} — ${m.month}`,
        }),
      };
      created.push({ month: m.month, entry: await this.accounting.createDraft(dto, userId) });
    }

    return {
      months_planned: plan.length,
      created: created.length,
      skipped,
      monthly_amount: round2(Number(body?.monthly_amount)),
      total_charge_eur: totalCharge,
      carrying_before: round2(Number(bal?.cost ?? 0) - Number(bal?.accumulated ?? 0)),
      carrying_after: round2(Number(bal?.cost ?? 0) - Number(bal?.accumulated ?? 0) - totalCharge),
      entries: created.map((c) => ({ month: c.month, id: c.entry.id, debit_eur: c.entry.total_debit_eur })),
    };
  }

  // ── جدولة الإهلاك واللحاق بها ─────────────────────────────────────────────

  listDepreciationSchedules(entityId: string) {
    return this.ds.query(
      `SELECT s.*, v.name AS vessel_name,
              e.code AS expense_code, e.name AS expense_name,
              a.code AS accumulated_code, a.name AS accumulated_name
         FROM depreciation_schedules s
         JOIN vessels v ON v.id = s.vessel_id
         JOIN accounting_accounts e ON e.id = s.expense_account_id
         JOIN accounting_accounts a ON a.id = s.accumulated_account_id
        WHERE s.legal_entity_id = $1
        ORDER BY v.name`, [entityId]);
  }

  async setDepreciationSchedule(body: any, userId: string | null) {
    const entityId = String(body?.legal_entity_id || '');
    await this.entity(entityId);
    const vesselId = String(body?.vessel_id || '');
    await this.assertInScope(entityId, vesselId, 'جدول الإهلاك');

    const expense = body?.expense_account_id
      ? await this.accountById(entityId, body.expense_account_id, 'حساب مصروف الإهلاك')
      : await this.byRole(entityId, 'DEPRECIATION_EXPENSE');
    const accumulated = body?.accumulated_account_id
      ? await this.accountById(entityId, body.accumulated_account_id, 'حساب مجمع الإهلاك')
      : await this.byRole(entityId, 'ACCUMULATED_DEPRECIATION');
    const cost = body?.cost_account_id
      ? await this.accountById(entityId, body.cost_account_id, 'حساب تكلفة الأصل')
      : await this.byRole(entityId, 'VESSEL_COST').catch(() => null);

    const amount = round2(Number(body?.monthly_amount));
    if (!(amount > 0)) throw new BadRequestException('القسط الشهري يجب أن يكون موجباً');
    const start = String(body?.start_month || '');
    const end = String(body?.end_month || '');
    // نهاية مُلزِمة: جدولٌ بلا نهاية يُهلِك الأصل تحت الصفر بصمت.
    monthsBetween(start, end);

    const [row] = await this.ds.query(
      `INSERT INTO depreciation_schedules
         (legal_entity_id, vessel_id, description, monthly_amount, start_month, end_month,
          expense_account_id, accumulated_account_id, cost_account_id, journal_code, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (legal_entity_id, vessel_id) WHERE is_active DO UPDATE
         SET description = EXCLUDED.description, monthly_amount = EXCLUDED.monthly_amount,
             start_month = EXCLUDED.start_month, end_month = EXCLUDED.end_month,
             expense_account_id = EXCLUDED.expense_account_id,
             accumulated_account_id = EXCLUDED.accumulated_account_id,
             cost_account_id = EXCLUDED.cost_account_id, updated_at = now()
       RETURNING *`,
      [entityId, vesselId, body?.description ?? null, amount, start, end,
       expense.id, accumulated.id, cost?.id ?? null, body?.journal_code || 'GJ', userId]);
    return row;
  }

  async deactivateDepreciationSchedule(id: string) {
    const [row] = await this.ds.query(
      'UPDATE depreciation_schedules SET is_active = false, updated_at = now() WHERE id = $1 RETURNING *', [id]);
    if (!row) throw new NotFoundException('الجدول غير موجود');
    return row;
  }

  /**
   * اللحاق: لكل جدول نشط، تُنشأ مسوّدات كل شهر **مكتمل** بلا قيد.
   *
   * لا يسأل «هل حان الموعد؟» بل «أي شهر فات بلا قيد؟» — فلا يفوته شهر مهما
   * انقطعت الخدمة، ولا يضرّه أن يُستدعى مئة مرة: فهرس التكرار يمنع الازدواج.
   *
   * ويُنشئ **مسوّدات لا قيوداً مُرحَّلة**. أتمتة تُرحّل بلا مراجع بشري تُدخل الدفتر
   * ما لا يستطيع أحد إخراجه.
   */
  async catchUpDepreciation(entityId: string, today: string, userId: string | null) {
    const schedules = await this.ds.query(
      'SELECT * FROM depreciation_schedules WHERE legal_entity_id = $1 AND is_active', [entityId]);

    const out: any[] = [];
    for (const s of schedules) {
      const due = monthsDue({ startMonth: s.start_month, endMonth: s.end_month, today });
      if (!due.length) { out.push({ vessel_id: s.vessel_id, created: 0, note: 'لا شهر مستحقّ بعد' }); continue; }
      try {
        const r = await this.postDepreciation({
          legal_entity_id: entityId, vessel_id: s.vessel_id,
          monthly_amount: Number(s.monthly_amount),
          from_month: due[0], to_month: due[due.length - 1],
          expense_account_id: s.expense_account_id,
          accumulated_account_id: s.accumulated_account_id,
          cost_account_id: s.cost_account_id ?? undefined,
          journal_code: s.journal_code,
          description: s.description || undefined,
          backdated_reason: `إهلاك دوري مُجدوَل — أُنشئ آلياً عن الأشهر المكتملة حتى ${today}.`,
        }, userId);
        out.push({ vessel_id: s.vessel_id, created: r.created, skipped: r.skipped.length, months: due });
      } catch (e: any) {
        // جدول متعثّر لا يُسقط البقية — والسبب يُقال لا يُبتلع.
        out.push({ vessel_id: s.vessel_id, created: 0, error: e?.message ?? 'تعذّر التوليد' });
      }
    }
    return { as_of: today, schedules: schedules.length, results: out };
  }

  // ── الإفراج الدوري عن الإيراد المكتسَب ────────────────────────────────────

  /**
   * يحسب المكتسَب في فترة من كل مشارطة تمسّها، ويبني قيد الإفراج.
   *
   * الحساب بالأيام لا بالشهور: مشارطة تعبر شهرين لا تُنسب لأحدهما كاملة. وهذا
   * ما جعل SV-26-07-03 تُستحقّ بيومٍ واحد من خمسة عشر في يوليو.
   */
  async releaseEarnedRevenue(body: any, userId: string | null) {
    const entityId = String(body?.legal_entity_id || '');
    await this.entity(entityId);
    const from = String(body?.period_start || '');
    const to = String(body?.period_end || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
      throw new BadRequestException('period_start و period_end بصيغة YYYY-MM-DD مطلوبان');
    }

    // المشارطات التي أُثبتت في الدفتر وحدها — ما لم يُقيَّد لا يُفرَج عنه.
    const rows = await this.ds.query(
      `SELECT h.invoice_number, h.total_amount, h.currency, h.hire_from, h.hire_to
         FROM hire_invoices h
         JOIN journal_entries je ON je.source_id = h.id
          AND je.source_type = 'hire_invoice' AND je.status = 'posted'
        WHERE je.legal_entity_id = $1`,
      [entityId]);

    const iso = (d: any) => new Date(d).toISOString().slice(0, 10);
    const splits = rows
      .filter((r: any) => r.hire_from && r.hire_to)
      .map((r: any) => splitHireRevenue(
        { invoice_no: r.invoice_number, total: Number(r.total_amount), from: iso(r.hire_from), to: iso(r.hire_to) },
        from, to))
      .filter((s) => s.earned > 0);

    const total = round2(splits.reduce((a, s) => a + s.earned, 0));
    if (!(total > 0)) {
      return { earned_eur: 0, lines: splits, entry: null, note: 'لا إيراد مكتسَب في هذه الفترة' };
    }

    const deferred = body?.deferred_account_id
      ? await this.accountById(entityId, body.deferred_account_id, 'حساب الإيراد المؤجَّل')
      : await this.byRole(entityId, 'DEFERRED_REVENUE');
    const revenue = body?.revenue_account_id
      ? await this.accountById(entityId, body.revenue_account_id, 'حساب الإيراد')
      : await this.byRole(entityId, 'CHARTER_REVENUE');

    const dto: CreateEntryDto = {
      legal_entity_id: entityId,
      journal_id: (await this.journalByCode(entityId, body?.journal_code || 'GJ')).id,
      accounting_date: to, source_document_date: to,
      description: body?.description
        || `الاعتراف بإيراد الإيجار المكتسَب — ${from} إلى ${to}`,
      reference: `REL-${to.slice(0, 7)}`,
      accounting_event_type: 'adjustment',
      source_type: null, source_id: null, source_reference: null,
      backdated_reason: body?.backdated_reason ?? null,
      lines: buildTwoSidedLines({
        debitAccountId: deferred.id, creditAccountId: revenue.id,
        amount: total, currency: EUR, fxRateId: null,
        debitDescription: 'إفراج عن الإيراد المقدَّم',
        creditDescription: `إيراد إيجار مكتسَب — ${from} إلى ${to}`,
      }),
    };

    return {
      earned_eur: total,
      breakdown: splits.map((s) => ({
        invoice: s.invoice_no, days_in_period: s.days_in_period, days_total: s.days_total, earned: s.earned,
      })),
      totals: summariseCutoff(splits),
      entry: await this.accounting.createDraft(dto, userId),
    };
  }

  // ── إطفاء المصروفات المدفوعة مقدماً ─────────────────────────

  listPrepaidSchedules(entityId: string) {
    return this.ds.query(
      `SELECT s.*, v.name AS vessel_name,
              e.code AS expense_code, e.name AS expense_name,
              p.code AS prepaid_code, p.name AS prepaid_name
         FROM prepaid_schedules s
    LEFT JOIN vessels v ON v.id = s.vessel_id
         JOIN accounting_accounts e ON e.id = s.expense_account_id
         JOIN accounting_accounts p ON p.id = s.prepaid_account_id
        WHERE s.legal_entity_id = $1
        ORDER BY s.source_reference`, [entityId]);
  }

  /**
   * تسجيل جدول إطفاء — أو تحديثه إن كان مرجعه مسجَّلاً.
   *
   * المرجع مفتاح: تحميل الكشف مرّتين لا يُنشئ جدولين فيُطفأ كل شيء ضِعفين.
   */
  async upsertPrepaidSchedule(body: any, userId: string | null) {
    const entityId = String(body?.legal_entity_id || '');
    await this.entity(entityId);
    const prepaid = await this.accountById(entityId, String(body?.prepaid_account_id || ''), 'حساب المصروف المقدَّم');
    const expense = await this.accountById(entityId, String(body?.expense_account_id || ''), 'حساب المصروف');
    const total = round2(Number(body?.total_amount));
    if (!(total > 0)) throw new BadRequestException('إجمالي المبلغ يجب أن يكون موجباً');

    const [row] = await this.ds.query(
      `INSERT INTO prepaid_schedules
         (legal_entity_id, vessel_id, customer_id, description, source_reference,
          total_amount, start_month, end_month, prepaid_account_id, expense_account_id,
          journal_code, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       ON CONFLICT (legal_entity_id, source_reference) WHERE is_active
       DO UPDATE SET total_amount = EXCLUDED.total_amount,
                     start_month = EXCLUDED.start_month, end_month = EXCLUDED.end_month,
                     expense_account_id = EXCLUDED.expense_account_id,
                     description = EXCLUDED.description, updated_at = now()
       RETURNING *`,
      [entityId, body?.vessel_id ?? null, body?.customer_id ?? null,
       body?.description ?? null, String(body?.source_reference || ''),
       String(total), String(body?.start_month || ''), String(body?.end_month || ''),
       prepaid.id, expense.id, body?.journal_code || 'GJ', userId]);
    return row;
  }

  private async loadSchedules(entityId: string): Promise<PrepaidSchedule[]> {
    const rows = await this.ds.query(
      'SELECT * FROM prepaid_schedules WHERE legal_entity_id = $1 AND is_active', [entityId]);
    return rows.map((r: any) => ({
      id: r.id, description: r.description, source_reference: r.source_reference,
      total_amount: Number(r.total_amount),
      start_month: r.start_month, end_month: r.end_month,
      expense_account_id: r.expense_account_id, prepaid_account_id: r.prepaid_account_id,
      vessel_id: r.vessel_id, customer_id: r.customer_id,
    }));
  }

  /**
   * توليد مسوّدات الإطفاء للأشهر المستحقّة.
   *
   * آمنٌ للتكرار: المعرّف الحتمي من الكيان والشهر يمنع قيداً ثانياً لشهرٍ
   * وُلِّد من قبل — ويمنعه فهرس التكرار في القاعدة لا فحصٌ تطبيقي.
   *
   * و`through_month` يسمح بالتوليد إلى نهاية السنة سلفاً: الجدول معلوم بالكامل
   * منذ الاعتراف، فلا داعي لانتظار كل شهر ليُكتشف.
   */
  async runAmortization(body: any, userId: string | null) {
    const entityId = String(body?.legal_entity_id || '');
    await this.entity(entityId);
    const schedules = await this.loadSchedules(entityId);
    if (!schedules.length) return { months: 0, created: 0, skipped: [], entries: [] };

    const posted = await this.ds.query(
      `SELECT DISTINCT to_char(e.accounting_date, 'YYYY-MM') AS m
         FROM journal_entries e
        WHERE e.legal_entity_id = $1 AND e.accounting_event_type = 'amortization'
          AND e.status <> 'void'`, [entityId]);

    let months = amortizationMonthsDue({
      schedules, today: new Date().toISOString().slice(0, 10),
      alreadyPosted: posted.map((r: any) => r.m),
    });

    // التوليد المسبق حتى شهرٍ محدَّد — بلا تجاوز نهاية الجداول
    const through = String(body?.through_month || '');
    if (/^\d{4}-(0[1-9]|1[0-2])$/.test(through)) {
      const end = schedules.map((s) => s.end_month).sort().reverse()[0];
      const upto = through < end ? through : end;
      const start = schedules.map((s) => s.start_month).sort()[0];
      const done = new Set(posted.map((r: any) => r.m));
      months = monthsBetween(start, upto).filter((m) => !done.has(m));
    }

    const journalId = (await this.journalByCode(entityId, body?.journal_code || 'GJ')).id;
    const created: any[] = [];
    const skipped: string[] = [];

    for (const month of months) {
      const plan = planMonth({ entityId, month, schedules, namespace: entityId });
      if (!plan) continue;

      const dup = await this.existingEntry(entityId, 'amortization', 'amortization', plan.source_id);
      if (dup) { skipped.push(`${month} (${dup.entry_no ?? 'مسوّدة'})`); continue; }

      const dto: CreateEntryDto = {
        legal_entity_id: entityId, journal_id: journalId,
        accounting_date: plan.accounting_date, source_document_date: plan.accounting_date,
        description: `إطفاء مصروفات مدفوعة مقدماً — ${month}`,
        reference: plan.source_reference,
        accounting_event_type: 'amortization',
        source_type: 'amortization', source_id: plan.source_id, source_reference: plan.source_reference,
        backdated_reason: body?.backdated_reason ?? 'إطفاء شهرٍ مكتمل يُولَّد بعد انقضائه',
        lines: [
          ...plan.debits.map((d) => ({
            account_id: d.expense_account_id, debit: d.amount, transaction_currency: EUR,
            vessel_id: d.vessel_id, description: d.description,
          })),
          {
            account_id: plan.credit.prepaid_account_id, credit: plan.credit.amount,
            transaction_currency: EUR, description: `إطفاء ${month} — تخفيض المصروف المقدَّم`,
          },
        ],
      };
      created.push({ month, total: plan.total, entry: await this.accounting.createDraft(dto, userId) });
    }

    return {
      months: months.length, created: created.length, skipped,
      total_eur: round2(created.reduce((s, c) => s + c.total, 0)),
      entries: created.map((c) => ({ month: c.month, id: c.entry.id, total: c.total })),
    };
  }
}
