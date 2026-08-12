import { Injectable, BadRequestException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AccountingService, CreateEntryDto } from '../accounting.service';
import { round2, EUR } from '../accounting-posting';
import { splitHireRevenue, summariseCutoff } from '../revenue-cutoff';
import { evaluateAccrualEligibility, AccrualCategory } from '../../receipts/receipt-eligibility';
import { buildTwoSidedLines, buildSettlementLines, assertSettleable, BridgeDims } from './accounting-bridge.logic';

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

  /** القيد القائم لهذا المصدر — يمنع الازدواج قبل أن يصطدم بفهرس قاعدة البيانات. */
  private async existingEntry(entityId: string, event: string, srcType: string, srcId: string) {
    const [e] = await this.ds.query(
      `SELECT id, entry_no, status FROM journal_entries
        WHERE legal_entity_id = $1 AND accounting_event_type = $2
          AND source_type = $3 AND source_id = $4 AND status <> 'void' LIMIT 1`,
      [entityId, event, srcType, srcId]);
    return e ?? null;
  }

  // ── فاتورة مورد ← استحقاق ─────────────────────────────────────────────────

  async postSupplierInvoice(invoiceId: string, body: any, userId: string | null) {
    const [inv] = await this.ds.query('SELECT * FROM invoices WHERE id = $1', [invoiceId]);
    if (!inv) throw new NotFoundException('الفاتورة غير موجودة');

    const entityId = String(body?.legal_entity_id || '');
    await this.entity(entityId);

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
}
