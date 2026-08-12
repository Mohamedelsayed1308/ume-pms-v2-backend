import { Injectable, BadRequestException, NotFoundException, ConflictException, UnprocessableEntityException, ForbiddenException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager, In } from 'typeorm';
import { LegalEntity } from './entities/legal-entity.entity';
import { Journal } from './entities/journal.entity';
import { FiscalYear } from './entities/fiscal-year.entity';
import { FiscalPeriod } from './entities/fiscal-period.entity';
import { AccountingAccount } from './entities/accounting-account.entity';
import { AccountingFxRate } from './entities/accounting-fx-rate.entity';
import { JournalEntry } from './entities/journal-entry.entity';
import { JournalLine } from './entities/journal-line.entity';
import { ACCOUNTING_EVENT_TYPES, UQ_JE_EVENT } from './accounting.constants';
import {
  prepareLines, assertBalanced, assertDateInPeriod, assertPeriodAcceptsPosting,
  resolveBackdating, formatEntryNo, assertCanEditDraft, assertCanPost, assertCanReverse,
  buildReversalLines, assertReversalDate, assertIsoDate, totalsByCurrency, round2,
  selectPeriod, assertOpeningBalanceAccounts, OPENING_EVENT,
  LineInput, AccountRef, FxRateRef, PreparedLine,
} from './accounting-posting';

/** اليوم بصيغة ISO — يُمرَّر صراحةً للمحرّك الخالص فيبقى الأخير قابلاً للاختبار. */
function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** الأعمدة النقدية تعود من pg نصوصاً — التحويل صريح لا ضمني. */
const n = (v: any): number => (v === null || v === undefined ? 0 : Number(v));

export interface CreateEntryDto {
  legal_entity_id: string;
  journal_id: string;
  accounting_date: string;
  source_document_date?: string;
  description: string;
  reference?: string | null;
  accounting_event_type?: string;
  source_type?: string | null;
  source_id?: string | null;
  source_reference?: string | null;
  backdated_reason?: string | null;
  lines: LineInput[];
}

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * P1.1A — خدمة المحاسبة
 *
 * دورة حياة القيد: `draft → posted → reversed` · و`draft → void` لا غير.
 * لا مسار يعيد قيداً مُرحَّلاً إلى المسوّدة، ولا مسار يحذفه.
 *
 * الترحيل كلّه داخل معاملة واحدة تشمل إسناد الرقم الرسمي: التراجع يُعيد العدّاد
 * معه، فلا فجوة في الترقيم ولا رقم مكرّر عند التزامن.
 * ═══════════════════════════════════════════════════════════════════════════
 */
@Injectable()
export class AccountingService {
  constructor(@InjectDataSource() private ds: DataSource) {}

  // ── الإعداد ───────────────────────────────────────────────────────────────
  listEntities() {
    return this.ds.getRepository(LegalEntity).find({ order: { code: 'ASC' } });
  }

  async createEntity(body: any) {
    const code = String(body?.code || '').trim().toUpperCase();
    const name = String(body?.name || '').trim();
    const ccy = String(body?.functional_currency || '').trim().toUpperCase();
    if (!code || !name) throw new BadRequestException('الرمز والاسم مطلوبان');
    if (!/^[A-Z]{3}$/.test(ccy)) throw new BadRequestException('عملة وظيفية غير صالحة');
    if (ccy !== 'EUR') throw new UnprocessableEntityException('P1.1A يدعم EUR كعملة وظيفية فقط');
    assertIsoDate(String(body?.accounting_start_date || ''), 'accounting_start_date');

    const repo = this.ds.getRepository(LegalEntity);
    if (await repo.findOne({ where: { code } })) throw new ConflictException('رمز الكيان مستخدم');
    return repo.save(repo.create({
      code, name,
      name_ar: body?.name_ar ?? null,
      functional_currency: ccy,
      fiscal_year_start_month: Number(body?.fiscal_year_start_month ?? 1),
      accounting_start_date: body.accounting_start_date,
      is_active: true,
    }));
  }

  listJournals(entityId: string) {
    return this.ds.getRepository(Journal).find({
      where: { legal_entity_id: entityId }, order: { code: 'ASC' },
    });
  }

  async createJournal(body: any) {
    const code = String(body?.code || '').trim().toUpperCase();
    const prefix = String(body?.entry_prefix || '').trim().toUpperCase();
    if (!code || !String(body?.name || '').trim()) throw new BadRequestException('الرمز والاسم مطلوبان');
    if (!/^[A-Z0-9-]{1,10}$/.test(prefix)) throw new BadRequestException('بادئة الترقيم غير صالحة');
    await this.mustFindEntity(body?.legal_entity_id);
    const repo = this.ds.getRepository(Journal);
    return repo.save(repo.create({
      legal_entity_id: body.legal_entity_id, code, name: String(body.name).trim(),
      entry_prefix: prefix, is_active: true,
    }));
  }

  /**
   * السنة المالية وفتراتها معاً في معاملة واحدة.
   *
   * الفترة 0 هي **الافتتاحية، وتقع في أول يوم من السنة المالية نفسها** لا قبلها.
   * الرصيد المُرحَّل يُثبَت **بأثر 01/01/2026** — أما 31/12/2025 فهو تاريخ مصدر
   * الرصيد (إقفال السنة السابقة) ولا يُعدّ فترة تابعة لـFY2026.
   *
   * الفصل بين الفترة 0 ويناير يتمّ بنوع الحدث لا بالتاريخ — انظر `selectPeriod`.
   */
  async createFiscalYear(body: any) {
    const entity = await this.mustFindEntity(body?.legal_entity_id);
    const year = Number(body?.year);
    if (!Number.isInteger(year) || year < 2000 || year > 2100) {
      throw new BadRequestException('سنة مالية غير صالحة');
    }
    return this.ds.transaction(async (m) => {
      const exists = await m.findOne(FiscalYear, { where: { legal_entity_id: entity.id, year } });
      if (exists) throw new ConflictException(`السنة المالية ${year} مُنشأة بالفعل`);

      const start = `${year}-01-01`;
      const end = `${year}-12-31`;
      const fy = await m.save(m.create(FiscalYear, {
        legal_entity_id: entity.id, year, start_date: start, end_date: end,
        status: 'open', next_entry_no: 1,
      }));

      const periods: Partial<FiscalPeriod>[] = [{
        legal_entity_id: entity.id, fiscal_year_id: fy.id, period_no: 0,
        name: `افتتاحي ${year}`,
        start_date: start, end_date: start, status: 'open',
      }];
      for (let p = 1; p <= 12; p++) {
        const mm = String(p).padStart(2, '0');
        const last = new Date(Date.UTC(year, p, 0)).getUTCDate();
        periods.push({
          legal_entity_id: entity.id, fiscal_year_id: fy.id, period_no: p,
          name: `${year}-${mm}`,
          start_date: `${year}-${mm}-01`, end_date: `${year}-${mm}-${last}`, status: 'open',
        });
      }
      await m.save(FiscalPeriod, periods.map((p) => m.create(FiscalPeriod, p)));
      return { fiscal_year: fy, periods_created: periods.length };
    });
  }

  listPeriods(entityId: string) {
    return this.ds.getRepository(FiscalPeriod).find({
      where: { legal_entity_id: entityId }, order: { period_no: 'ASC' },
    });
  }

  listAccounts(entityId: string) {
    return this.ds.getRepository(AccountingAccount).find({
      where: { legal_entity_id: entityId }, order: { code: 'ASC' },
    });
  }

  /**
   * إنشاء حساب. **لا يُنشئ P1.1A أي حساب تلقائياً** — دليل الحسابات قرار محاسبي
   * يُعتمد في مرحلة لاحقة، والنظام لا يخترع حساباً لأنه احتاجه.
   */
  async createAccount(body: any) {
    await this.mustFindEntity(body?.legal_entity_id);
    const code = String(body?.code || '').trim();
    const type = String(body?.account_type || '').trim();
    const normal = String(body?.normal_balance || '').trim();
    if (!code || !String(body?.name || '').trim()) throw new BadRequestException('الرمز والاسم مطلوبان');
    if (!['asset', 'liability', 'equity', 'revenue', 'expense'].includes(type)) {
      throw new BadRequestException('تصنيف حساب غير صالح');
    }
    if (!['debit', 'credit'].includes(normal)) throw new BadRequestException('طبيعة رصيد غير صالحة');

    const repo = this.ds.getRepository(AccountingAccount);
    if (await repo.findOne({ where: { legal_entity_id: body.legal_entity_id, code } })) {
      throw new ConflictException('رمز الحساب مستخدم في هذا الكيان');
    }
    const role = body?.system_role ? String(body.system_role).trim() : null;
    if (role && await repo.findOne({ where: { legal_entity_id: body.legal_entity_id, system_role: role } })) {
      throw new ConflictException(`الدور ${role} مُسنَد لحساب آخر — الدور واحد لكل كيان`);
    }
    return repo.save(repo.create({
      legal_entity_id: body.legal_entity_id, code,
      name: String(body.name).trim(), name_ar: body?.name_ar ?? null,
      account_type: type, account_group: body?.account_group ?? null, system_role: role,
      normal_balance: normal, parent_id: body?.parent_id ?? null,
      level: Number(body?.level ?? 1),
      is_postable: body?.is_postable !== false,
      is_monetary: !!body?.is_monetary,
      is_related_party: !!body?.is_related_party,
      requires_subledger: !!body?.requires_subledger,
      currency_restriction: body?.currency_restriction ?? null,
      is_active: true,
    }));
  }

  async listFxRates(entityId: string) {
    const rows = await this.ds.getRepository(AccountingFxRate).find({
      where: { legal_entity_id: entityId }, order: { rate_date: 'DESC' }, take: 500,
    });
    return rows.map((r) => decorateFxRate(r));
  }

  /** سعر الصرف لا يُقبل بلا تاريخ ومصدر — والسعر اليدوي بلا معتمِد يُرفض هنا وفي القاعدة. */
  async createFxRate(body: any, userId: string | null) {
    await this.mustFindEntity(body?.legal_entity_id);
    const from = String(body?.currency_from || '').toUpperCase();
    const to = String(body?.currency_to || 'EUR').toUpperCase();
    const rate = Number(body?.rate);
    const source = String(body?.source || '').toUpperCase();
    assertIsoDate(String(body?.rate_date || ''), 'rate_date');
    if (!/^[A-Z]{3}$/.test(from) || !/^[A-Z]{3}$/.test(to)) throw new BadRequestException('رمز عملة غير صالح');
    if (to !== 'EUR') throw new UnprocessableEntityException('السعر يُسجَّل مقابل العملة الوظيفية EUR');
    if (from === 'EUR') throw new UnprocessableEntityException('لا يُسجَّل سعر لليورو مقابل نفسه');
    if (!(rate > 0)) throw new BadRequestException('سعر الصرف يجب أن يكون موجباً');
    if (!['ECB', 'BANK', 'MANUAL_APPROVED', 'OTHER_APPROVED'].includes(source)) {
      throw new BadRequestException('مصدر سعر صرف غير معتمد');
    }
    const repo = this.ds.getRepository(AccountingFxRate);
    return repo.save(repo.create({
      legal_entity_id: body.legal_entity_id,
      currency_from: from, currency_to: to,
      rate: String(rate), rate_date: body.rate_date, source,
      source_reference: body?.source_reference ?? null,
      created_by: userId,
      // السعر يُنشأ مسوّدة دائماً. الاعتماد واقعة لاحقة منفصلة يقوم بها شخص آخر —
      // فلا اعتماد ذاتي ولا اعتماد تلقائي لمصدر بعينه.
      approved_by: null,
      approved_at: null,
    }));
  }

  /**
   * اعتماد سعر صرف. الفصل مفروض على **مستوى المستخدم** لا الشاشة وحدها:
   * مَن أنشأ السعر لا يعتمده مهما كانت صلاحياته.
   * والعملية idempotent — السعر المعتمَد يُعاد كما هو بلا خطأ ولا إعادة ختم.
   */
  async approveFxRate(id: string, userId: string | null) {
    const repo = this.ds.getRepository(AccountingFxRate);
    const fx = await repo.findOne({ where: { id } });
    if (!fx) throw new NotFoundException('سعر الصرف غير موجود');
    if (fx.approved_by) return decorateFxRate(fx);
    if (!userId) throw new UnprocessableEntityException('الاعتماد يحتاج مستخدماً معروفاً');
    if (fx.created_by && fx.created_by === userId) {
      throw new ForbiddenException('مُنشئ السعر لا يعتمده — فصل الواجبات');
    }
    fx.approved_by = userId;
    fx.approved_at = new Date();
    return decorateFxRate(await repo.save(fx));
  }

  // ── القيود ────────────────────────────────────────────────────────────────
  async listEntries(q: any) {
    const qb = this.ds.getRepository(JournalEntry).createQueryBuilder('e')
      .orderBy('e.accounting_date', 'DESC').addOrderBy('e.created_at', 'DESC').take(Number(q?.limit) || 200);
    if (q?.legal_entity_id) qb.andWhere('e.legal_entity_id = :le', { le: q.legal_entity_id });
    if (q?.status) qb.andWhere('e.status = :st', { st: q.status });
    if (q?.fiscal_period_id) qb.andWhere('e.fiscal_period_id = :fp', { fp: q.fiscal_period_id });
    if (q?.from) qb.andWhere('e.accounting_date >= :f', { f: q.from });
    if (q?.to) qb.andWhere('e.accounting_date <= :t', { t: q.to });
    return qb.getMany();
  }

  async getEntry(id: string) {
    const entry = await this.ds.getRepository(JournalEntry).findOne({ where: { id } });
    if (!entry) throw new NotFoundException('القيد غير موجود');
    const lines = await this.ds.getRepository(JournalLine).find({
      where: { entry_id: id }, order: { line_no: 'ASC' },
    });
    return { ...entry, lines, totals_by_currency: totalsByCurrency(lines.map(toPrepared)) };
  }

  /**
   * إنشاء مسوّدة. لا رقم رسمي ولا أثر في الدفاتر — المسوّدة ليست قيداً بعد.
   *
   * ⚠️ القراءة النهائية **بعد** الالتزام لا داخله: `getEntry` تستخدم الاتصال
   * الخارجي، فلا ترى صفوفاً لم تُلتزَم بعد. القاعدة نفسها في كل عملية أدناه.
   */
  async createDraft(dto: CreateEntryDto, userId: string | null) {
    const id = await this.ds.transaction(async (m) => {
      const ctx = await this.resolveContext(m, dto);
      const prepared = prepareLines(dto.lines, ctx.prepare);
      assertBalanced(prepared);
      // الرصيد الافتتاحي يمسّ المركز المالي لا نتيجة السنة
      if ((dto.accounting_event_type || 'manual') === OPENING_EVENT) {
        assertOpeningBalanceAccounts(prepared.lines, ctx.prepare.accounts);
      }

      const back = resolveBackdating(dto.accounting_date, todayIso(), dto.backdated_reason);
      const eventType = dto.accounting_event_type || 'manual';
      if (!(ACCOUNTING_EVENT_TYPES as readonly string[]).includes(eventType)) {
        throw new BadRequestException('نوع حدث محاسبي غير معروف');
      }
      if (eventType === 'reversal') {
        throw new UnprocessableEntityException('قيد العكس يُنشأ من مسار العكس وحده');
      }
      if (dto.source_id && !dto.source_type) {
        throw new BadRequestException('source_id بلا source_type — المرجع ناقص');
      }
      const description = String(dto.description || '').trim();
      if (!description) throw new BadRequestException('وصف القيد مطلوب');

      const entry = await m.save(m.create(JournalEntry, {
        legal_entity_id: ctx.entity.id,
        journal_id: ctx.journal.id,
        fiscal_year_id: ctx.period.fiscal_year_id,
        fiscal_period_id: ctx.period.id,
        entry_no: null,
        status: 'draft',
        accounting_event_type: eventType,
        source_document_date: dto.source_document_date || dto.accounting_date,
        accounting_date: dto.accounting_date,
        description,
        reference: dto.reference ?? null,
        source_type: dto.source_type ?? null,
        source_id: dto.source_id ?? null,
        source_reference: dto.source_reference ?? null,
        is_backdated: back.is_backdated,
        backdated_reason: back.backdated_reason,
        total_debit_eur: prepared.total_debit_eur.toFixed(2),
        total_credit_eur: prepared.total_credit_eur.toFixed(2),
        created_by: userId,
      })).catch(rethrowDuplicateEvent);

      await this.writeLines(m, entry.id, prepared.lines);
      return entry.id;
    });
    return this.getEntry(id);
  }

  /** تعديل مسوّدة = استبدال أسطرها بالكامل. التعديل الجزئي يفتح باب أسطر يتيمة. */
  async updateDraft(id: string, dto: CreateEntryDto, userId: string | null) {
    await this.ds.transaction(async (m) => {
      const entry = await m.findOne(JournalEntry, { where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!entry) throw new NotFoundException('القيد غير موجود');
      assertCanEditDraft(entry.status);

      // نوع الحدث يأتي من القيد المحفوظ لا من الطلب: مسوّدة تسوية في فترة مُقفلة
      // مبدئياً يجب أن تظل قابلة للتعديل، ولا يجوز للطلب أن يغيّر تصنيفها.
      const ctx = await this.resolveContext(m, {
        ...dto,
        legal_entity_id: entry.legal_entity_id,
        accounting_event_type: entry.accounting_event_type,
      });
      const description = String(dto.description || '').trim();
      if (!description) throw new BadRequestException('وصف القيد مطلوب');
      const prepared = prepareLines(dto.lines, ctx.prepare);
      assertBalanced(prepared);
      const back = resolveBackdating(dto.accounting_date, todayIso(), dto.backdated_reason);

      await m.delete(JournalLine, { entry_id: id });
      await this.writeLines(m, id, prepared.lines);
      await m.update(JournalEntry, id, {
        journal_id: ctx.journal.id,
        fiscal_year_id: ctx.period.fiscal_year_id,
        fiscal_period_id: ctx.period.id,
        accounting_date: dto.accounting_date,
        source_document_date: dto.source_document_date || dto.accounting_date,
        description,
        reference: dto.reference ?? null,
        is_backdated: back.is_backdated,
        backdated_reason: back.backdated_reason,
        total_debit_eur: prepared.total_debit_eur.toFixed(2),
        total_credit_eur: prepared.total_credit_eur.toFixed(2),
      });
    });
    return this.getEntry(id);
  }

  /** الإلغاء لا الحذف: المسوّدة الملغاة تبقى أثراً. والمُرحَّل لا يُلغى أصلاً. */
  async voidDraft(id: string, reason: string, userId: string | null) {
    if (!String(reason || '').trim()) throw new BadRequestException('سبب الإلغاء مطلوب');
    await this.ds.transaction(async (m) => {
      const entry = await m.findOne(JournalEntry, { where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!entry) throw new NotFoundException('القيد غير موجود');
      assertCanEditDraft(entry.status);
      await m.update(JournalEntry, id, {
        status: 'void',
        description: `${entry.description} [ملغى: ${String(reason).trim()}]`.slice(0, 500),
      });
    });
    return this.getEntry(id);
  }

  /**
   * الترحيل — النقطة التي يصير عندها القيد جزءاً من الدفاتر.
   *
   * كل شيء داخل معاملة واحدة: إعادة التحقق من الأسطر المحفوظة (لا من مدخلات
   * الطلب)، فحص حالة الفترة لحظتها، إسناد الرقم من عدّاد مقفول، ثم التثبيت.
   * إعادة التحقق ليست تكراراً: الحساب قد يكون عُطِّل والفترة قد تكون أُقفلت بعد
   * إنشاء المسوّدة.
   */
  async post(id: string, userId: string | null) {
    await this.ds.transaction(async (m) => {
      const entry = await m.findOne(JournalEntry, { where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!entry) throw new NotFoundException('القيد غير موجود');
      assertCanPost(entry.status);

      const period = await m.findOne(FiscalPeriod, { where: { id: entry.fiscal_period_id } });
      if (!period) throw new UnprocessableEntityException('فترة القيد غير موجودة');
      assertPeriodAcceptsPosting(period as any, entry.accounting_event_type);
      assertDateInPeriod(entry.accounting_date, period as any);

      const lines = await m.find(JournalLine, { where: { entry_id: id }, order: { line_no: 'ASC' } });
      if (lines.length < 2) throw new UnprocessableEntityException('القيد يحتاج سطرين على الأقل');

      // الحسابات تُعاد قراءتها الآن: قد يكون أحدها عُطِّل بعد إنشاء المسوّدة.
      const accounts = await m.find(AccountingAccount, {
        where: { id: In([...new Set(lines.map((l) => l.account_id))]) },
      });
      const byId = new Map(accounts.map((a) => [a.id, a]));
      for (const l of lines) {
        const a = byId.get(l.account_id);
        if (!a) throw new UnprocessableEntityException('حساب غير موجود على أحد الأسطر');
        if (!a.is_active) throw new UnprocessableEntityException(`الحساب ${a.code} غير نشط`);
        if (!a.is_postable) throw new UnprocessableEntityException(`الحساب ${a.code} تجميعي`);
        if (a.legal_entity_id !== entry.legal_entity_id) {
          throw new UnprocessableEntityException(`الحساب ${a.code} يخصّ كياناً آخر`);
        }
      }

      const td = round2(lines.reduce((s, l) => round2(s + n(l.debit_eur)), 0));
      const tc = round2(lines.reduce((s, l) => round2(s + n(l.credit_eur)), 0));
      assertBalanced({ lines: [], total_debit_eur: td, total_credit_eur: tc });

      const entryNo = await this.nextEntryNo(m, entry.fiscal_year_id, entry.journal_id);
      await m.update(JournalEntry, id, {
        status: 'posted', entry_no: entryNo,
        total_debit_eur: td.toFixed(2), total_credit_eur: tc.toFixed(2),
        posted_by: userId, posted_at: new Date(),
      });
    });
    return this.getEntry(id);
  }

  /**
   * العكس — الطريق **الوحيد** لإبطال أثر قيد مُرحَّل.
   * لا حذف ولا تعديل: يُنشأ قيد مضاد بسعر الصرف الأصلي نفسه، ويُربط الطرفان.
   */
  async reverse(id: string, body: any, userId: string | null) {
    const reason = String(body?.reason || '').trim();
    if (!reason) throw new BadRequestException('سبب العكس مطلوب');

    const revId = await this.ds.transaction(async (m) => {
      const original = await m.findOne(JournalEntry, { where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!original) throw new NotFoundException('القيد غير موجود');
      assertCanReverse(original);

      const revDate = String(body?.reversal_date || todayIso());
      assertReversalDate(original.accounting_date, revDate);

      // فترة العكس تُشتق من تاريخه — الفترة الافتتاحية (0) مستبعدة: العكس حركة
      // لاحقة لا رصيد افتتاحي.
      const target = await m.createQueryBuilder(FiscalPeriod, 'p')
        .where('p.legal_entity_id = :le', { le: original.legal_entity_id })
        .andWhere('p.start_date <= :d AND p.end_date >= :d', { d: revDate })
        .andWhere('p.period_no > 0')
        .getOne();
      if (!target) throw new UnprocessableEntityException(`لا توجد فترة محاسبية تغطّي ${revDate}`);
      assertPeriodAcceptsPosting(target as any, 'reversal');
      assertDateInPeriod(revDate, target as any);

      const lines = await m.find(JournalLine, { where: { entry_id: id }, order: { line_no: 'ASC' } });
      const reversed = buildReversalLines(lines.map(toPrepared));

      const rev = await m.save(m.create(JournalEntry, {
        legal_entity_id: original.legal_entity_id,
        journal_id: original.journal_id,
        fiscal_year_id: target.fiscal_year_id,
        fiscal_period_id: target.id,
        entry_no: null,
        status: 'draft',
        accounting_event_type: 'reversal',
        source_document_date: original.source_document_date,
        accounting_date: revDate,
        description: `عكس ${original.entry_no}: ${reason}`.slice(0, 500),
        reference: original.reference,
        source_type: original.source_type,
        source_id: original.source_id,
        source_reference: original.source_reference,
        is_backdated: revDate < todayIso(),
        backdated_reason: revDate < todayIso() ? `عكس بأثر رجعي: ${reason}`.slice(0, 500) : null,
        reversal_of_entry_id: original.id,
        total_debit_eur: n(original.total_credit_eur).toFixed(2),
        total_credit_eur: n(original.total_debit_eur).toFixed(2),
        created_by: userId,
      })).catch(rethrowDuplicateEvent);

      await this.writeLines(m, rev.id, reversed);

      const entryNo = await this.nextEntryNo(m, target.fiscal_year_id, original.journal_id);
      await m.update(JournalEntry, rev.id, {
        status: 'posted', entry_no: entryNo, posted_by: userId, posted_at: new Date(),
      });
      // الأصل يُوسَم معكوساً — المشغّل يسمح بهذا الانتقال وحده على المُرحَّل.
      await m.update(JournalEntry, original.id, {
        status: 'reversed', reversed_by_entry_id: rev.id,
      });
      return rev.id;
    });
    return this.getEntry(revId);
  }

  // ── الفترات ───────────────────────────────────────────────────────────────
  /** الإقفال يوثَّق بمن أقفل ومتى ولماذا — وإلا صار الإقفال بلا مسؤول. */
  async closePeriod(id: string, body: any, userId: string | null) {
    const hard = !!body?.hard;
    const reason = String(body?.reason || '').trim();
    if (!reason) throw new BadRequestException('سبب الإقفال مطلوب');
    return this.ds.transaction(async (m) => {
      const p = await m.findOne(FiscalPeriod, { where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!p) throw new NotFoundException('الفترة غير موجودة');
      if (p.status === 'hard_closed') throw new ConflictException('الفترة مُقفلة نهائياً');
      if (!hard && p.status === 'soft_closed') throw new ConflictException('الفترة مُقفلة مبدئياً بالفعل');

      const drafts = await m.count(JournalEntry, { where: { fiscal_period_id: id, status: 'draft' } });
      if (drafts > 0) {
        throw new UnprocessableEntityException(
          `لا تُقفل فترة بها ${drafts} مسوّدة معلّقة — رحِّلها أو ألغِها أولاً`,
        );
      }
      await m.update(FiscalPeriod, id, {
        status: hard ? 'hard_closed' : 'soft_closed',
        closed_by: userId, closed_at: new Date(), close_reason: reason,
      });
      return m.findOne(FiscalPeriod, { where: { id } });
    });
  }

  /** إعادة الفتح من الإقفال المبدئي فقط. النهائي نهائي — التصحيح في فترة لاحقة. */
  async reopenPeriod(id: string, body: any, userId: string | null) {
    const reason = String(body?.reason || '').trim();
    if (!reason) throw new BadRequestException('سبب إعادة الفتح مطلوب');
    return this.ds.transaction(async (m) => {
      const p = await m.findOne(FiscalPeriod, { where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!p) throw new NotFoundException('الفترة غير موجودة');
      if (p.status === 'hard_closed') {
        throw new ConflictException('الإقفال النهائي لا يُعاد فتحه — التصحيح بقيد في فترة لاحقة');
      }
      if (p.status === 'open') throw new ConflictException('الفترة مفتوحة بالفعل');
      await m.update(FiscalPeriod, id, {
        status: 'open', reopened_by: userId, reopened_at: new Date(), reopen_reason: reason,
      });
      return m.findOne(FiscalPeriod, { where: { id } });
    });
  }

  // ── ميزان المراجعة ────────────────────────────────────────────────────────
  /**
   * قراءة تحقّق من الدفتر باليورو — القيود المُرحَّلة والمعكوسة وحدها.
   * المسوّدات مستبعدة: ما لم يُرحَّل ليس في الدفاتر.
   */
  async trialBalance(q: any) {
    if (!q?.legal_entity_id) throw new BadRequestException('legal_entity_id مطلوب');
    const rows = await this.ds.query(
      `SELECT a.id, a.code, a.name, a.account_type, a.normal_balance,
              SUM(l.debit_eur)  AS debit_eur,
              SUM(l.credit_eur) AS credit_eur
         FROM journal_lines l
         JOIN journal_entries e ON e.id = l.entry_id
         JOIN accounting_accounts a ON a.id = l.account_id
        WHERE e.legal_entity_id = $1
          AND e.status IN ('posted','reversed')
          AND ($2::date IS NULL OR e.accounting_date >= $2::date)
          AND ($3::date IS NULL OR e.accounting_date <= $3::date)
        GROUP BY a.id, a.code, a.name, a.account_type, a.normal_balance
        ORDER BY a.code`,
      [q.legal_entity_id, q?.from || null, q?.to || null],
    );
    const accounts = rows.map((r: any) => ({
      ...r,
      debit_eur: round2(n(r.debit_eur)),
      credit_eur: round2(n(r.credit_eur)),
      balance_eur: round2(n(r.debit_eur) - n(r.credit_eur)),
    }));
    const total_debit_eur = round2(accounts.reduce((s: number, r: any) => round2(s + r.debit_eur), 0));
    const total_credit_eur = round2(accounts.reduce((s: number, r: any) => round2(s + r.credit_eur), 0));
    return {
      currency: 'EUR',
      accounts,
      total_debit_eur,
      total_credit_eur,
      is_balanced: round2(total_debit_eur - total_credit_eur) === 0,
    };
  }

  // ── داخلي ─────────────────────────────────────────────────────────────────
  private async mustFindEntity(id: string): Promise<LegalEntity> {
    if (!id) throw new BadRequestException('legal_entity_id مطلوب');
    const e = await this.ds.getRepository(LegalEntity).findOne({ where: { id } });
    if (!e) throw new NotFoundException('الكيان القانوني غير موجود');
    if (!e.is_active) throw new UnprocessableEntityException('الكيان القانوني غير نشط');
    return e;
  }

  /** يجمع كل ما يحتاجه المحرّك الخالص: الكيان، الدفتر، الفترة، الحسابات، الأسعار. */
  private async resolveContext(m: EntityManager, dto: CreateEntryDto) {
    assertIsoDate(String(dto?.accounting_date || ''), 'accounting_date');
    if (dto?.source_document_date) assertIsoDate(dto.source_document_date, 'source_document_date');

    const entity = await m.findOne(LegalEntity, { where: { id: dto.legal_entity_id } });
    if (!entity) throw new NotFoundException('الكيان القانوني غير موجود');
    if (!entity.is_active) throw new UnprocessableEntityException('الكيان القانوني غير نشط');
    if (dto.accounting_date < entity.accounting_start_date) {
      throw new UnprocessableEntityException(
        `تاريخ القيد يسبق بداية المحاسبة للكيان (${entity.accounting_start_date})`,
      );
    }

    const journal = await m.findOne(Journal, { where: { id: dto.journal_id } });
    if (!journal) throw new NotFoundException('دفتر اليومية غير موجود');
    if (journal.legal_entity_id !== entity.id) {
      throw new UnprocessableEntityException('الدفتر يخصّ كياناً قانونياً آخر');
    }
    if (!journal.is_active) throw new UnprocessableEntityException('الدفتر غير نشط');

    // الفترة تُشتق من التاريخ لا تُختار: اختيارها يدوياً يفتح باب قيد في فترة لا تخصّه.
    // لكن التاريخ وحده لا يكفي: الفترة 0 ويناير يتقاطعان في 01/01، فيفصل بينهما
    // **نوع الحدث** — القرار في `selectPeriod` وحده، ومُختبَر منفصلاً عن القاعدة.
    const candidates = await m.createQueryBuilder(FiscalPeriod, 'p')
      .where('p.legal_entity_id = :le', { le: entity.id })
      .andWhere('p.start_date <= :d AND p.end_date >= :d', { d: dto.accounting_date })
      .orderBy('p.period_no', 'ASC')
      .getMany();
    if (!candidates.length) {
      throw new UnprocessableEntityException(
        `لا توجد فترة محاسبية تغطّي ${dto.accounting_date} — أنشئ السنة المالية أولاً`,
      );
    }
    const eventType = dto.accounting_event_type || 'manual';
    const period = selectPeriod(eventType, candidates as any);
    assertPeriodAcceptsPosting(period as any, eventType);

    const lineInputs = Array.isArray(dto.lines) ? dto.lines : [];
    const accountIds = [...new Set(lineInputs.map((l) => l?.account_id).filter(Boolean))];
    const fxIds = [...new Set(lineInputs.map((l) => l?.fx_rate_id).filter(Boolean) as string[])];
    const accounts = accountIds.length
      ? await m.find(AccountingAccount, { where: { id: In(accountIds) } }) : [];
    const fxRates = fxIds.length
      ? await m.find(AccountingFxRate, { where: { id: In(fxIds) } }) : [];

    return {
      entity, journal, period,
      prepare: {
        legal_entity_id: entity.id,
        functional_currency: entity.functional_currency,
        accounting_date: dto.accounting_date,
        accounts: new Map<string, AccountRef>(accounts.map((a) => [a.id, a as any])),
        fxRates: new Map<string, FxRateRef>(fxRates.map((f) => [f.id, f as any])),
      },
    };
  }

  private async writeLines(m: EntityManager, entryId: string, lines: PreparedLine[]) {
    await m.save(JournalLine, lines.map((l) => m.create(JournalLine, {
      entry_id: entryId,
      line_no: l.line_no,
      account_id: l.account_id,
      debit: l.debit.toFixed(2),
      credit: l.credit.toFixed(2),
      transaction_currency: l.transaction_currency,
      fx_rate: String(l.fx_rate),
      fx_date: l.fx_date,
      fx_source: l.fx_source,
      fx_rate_id: l.fx_rate_id,
      debit_eur: l.debit_eur.toFixed(2),
      credit_eur: l.credit_eur.toFixed(2),
      vessel_id: l.vessel_id,
      supplier_id: l.supplier_id,
      customer_id: l.customer_id,
      cost_center_id: l.cost_center_id,
      description: l.description,
    })));
  }

  /**
   * الرقم التالي من عدّاد السنة **بقفل الصف**.
   * القفل يُسلسل الطلبات المتزامنة، والمعاملة تُعيد العدّاد عند أي فشل لاحق —
   * فالترقيم متصل بلا فجوة ولا تكرار.
   */
  private async nextEntryNo(m: EntityManager, fiscalYearId: string, journalId: string): Promise<string> {
    const rows = await m.query(
      'SELECT year, next_entry_no FROM fiscal_years WHERE id = $1 FOR UPDATE', [fiscalYearId],
    );
    if (!rows?.length) throw new UnprocessableEntityException('السنة المالية غير موجودة');
    const journal = await m.findOne(Journal, { where: { id: journalId } });
    if (!journal) throw new UnprocessableEntityException('الدفتر غير موجود');
    const seq = Number(rows[0].next_entry_no);
    await m.query('UPDATE fiscal_years SET next_entry_no = next_entry_no + 1 WHERE id = $1', [fiscalYearId]);
    return formatEntryNo(journal.entry_prefix, Number(rows[0].year), seq);
  }
}

/** أسطر محفوظة (نصوص من pg) → شكل المحرّك الخالص. */
function toPrepared(l: JournalLine): PreparedLine {
  return {
    line_no: l.line_no,
    account_id: l.account_id,
    debit: n(l.debit), credit: n(l.credit),
    transaction_currency: l.transaction_currency,
    fx_rate: n(l.fx_rate), fx_date: l.fx_date, fx_source: l.fx_source, fx_rate_id: l.fx_rate_id,
    debit_eur: n(l.debit_eur), credit_eur: n(l.credit_eur),
    vessel_id: l.vessel_id, supplier_id: l.supplier_id, customer_id: l.customer_id,
    cost_center_id: l.cost_center_id, description: l.description,
  };
}

/** الفهرس الفريد يمنع تكرار الحدث المحاسبي — يُترجَم لرسالة مفهومة لا لـ500. */
/**
 * اتجاه السعر أخطر ما في إدخاله. ECB ينشر `1 EUR = X USD` والنظام يخزّن
 * `1 USD = Y EUR` — ونسخ رقم ECB كما هو يضخّم كل مبلغ دولاري بلا اعتراض.
 * فيُرافق كل سعر لافتةٌ تقرأ اتجاهه الفعلي، ولا يُترك القارئ يستنتجه من أسماء
 * الأعمدة.
 */
export function fxDirectionLabel(r: { currency_from: string; currency_to: string; rate: string | number }): string {
  return `1 ${r.currency_from} = ${r.rate} ${r.currency_to}`;
}

export function decorateFxRate<T extends { currency_from: string; currency_to: string; rate: string | number; approved_by?: string | null }>(r: T) {
  return {
    ...r,
    rate_label: fxDirectionLabel(r),
    inverse_label: `1 ${r.currency_to} = ${(1 / Number(r.rate)).toFixed(8)} ${r.currency_from}`,
    is_approved: !!r.approved_by,
  };
}

function rethrowDuplicateEvent(err: any): never {
  if (err?.code === '23505' && String(err?.constraint || '').includes(UQ_JE_EVENT)) {
    throw new ConflictException('لهذا المستند قيد بنفس نوع الحدث المحاسبي بالفعل');
  }
  throw err;
}
