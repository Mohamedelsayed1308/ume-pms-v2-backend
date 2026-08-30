import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  StoneRound, StoneParentLedger, StoneInvestmentLedger, StoneBankConfirmation,
  StoneFundCall, StoneVessel, StoneOpenItem, StoneInterestTerm,
} from './stone.entity';
import { accrueInterest, type ParentMove, type InterestTerm } from './stone-interest';
import { planSeed, type SeedPayload, type SeedPlan } from './stone-seed';

const n = (v: unknown) => Number(v) || 0;
const r2 = (v: number) => Math.round(v * 100) / 100;

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * خدمة كارت Stone
 *
 * ── ولا رصيدَ مخزَّن ──
 * كلُّ إجماليٍّ يُشتقّ من حركاته عند كلّ نداء. فلا رقمَ محفوظٌ يستطيع أن يخالف
 * مكوّناته — وهي العلّة التي جعلت رحلةً في دفتر بيلاجوس تحمل صافياً يناقض
 * أعمدتها، فبقيت شهوراً بلا أن يشعر أحد.
 * ═══════════════════════════════════════════════════════════════════════════
 */
@Injectable()
export class InvestmentsService {
  constructor(
    @InjectRepository(StoneRound) private rounds: Repository<StoneRound>,
    @InjectRepository(StoneParentLedger) private parent: Repository<StoneParentLedger>,
    @InjectRepository(StoneInvestmentLedger) private inv: Repository<StoneInvestmentLedger>,
    @InjectRepository(StoneBankConfirmation) private banks: Repository<StoneBankConfirmation>,
    @InjectRepository(StoneFundCall) private calls: Repository<StoneFundCall>,
    @InjectRepository(StoneVessel) private vessels: Repository<StoneVessel>,
    @InjectRepository(StoneOpenItem) private items: Repository<StoneOpenItem>,
    @InjectRepository(StoneInterestTerm) private terms: Repository<StoneInterestTerm>,
  ) {}

  /**
   * الكارت كاملاً في نداءٍ واحد.
   *
   * فالشاشة تعرض الدورة الرباعيّة مجتمعةً، وتقسيمُها على ستّة نداءاتٍ يجعل
   * الأرقام تصل متفرّقةً فتُقرأ لحظةً وهي ناقصة.
   */
  async card(asOf?: string) {
    const today = new Date().toISOString().slice(0, 10);
    const at = asOf && /^\d{4}-\d{2}-\d{2}$/.test(asOf) ? asOf : today;

    const [rounds, parentRows, invRows, bankRows, callRows, vesselRows, itemRows, termRows] =
      await Promise.all([
        this.rounds.find({ order: { round_no: 'ASC' } }),
        this.parent.find({ order: { occurred_at: 'ASC' } }),
        this.inv.find({ order: { call_date: 'ASC', paid_date: 'ASC' } }),
        this.banks.find({ order: { occurred_at: 'DESC' } }),
        this.calls.find({ order: { as_of: 'ASC' } }),
        this.vessels.find({ order: { created_at: 'ASC' } }),
        this.items.find({ order: { sort_order: 'ASC', created_at: 'ASC' } }),
        this.terms.find({ order: { effective_from: 'ASC' } }),
      ]);

    // ── دفتر الأمّ ──
    const moves: ParentMove[] = parentRows.map((m) => ({
      occurred_at: m.occurred_at,
      direction: m.direction,
      kind: m.kind,
      amount_usd: n(m.amount_usd),
    }));
    const funded = r2(moves.filter((m) => m.direction === 'funding' && m.kind === 'principal').reduce((a, m) => a + m.amount_usd, 0));
    const repaid = r2(moves.filter((m) => m.direction === 'repayment' && m.kind === 'principal').reduce((a, m) => a + m.amount_usd, 0));

    const interest = accrueInterest(
      moves,
      termRows.map<InterestTerm>((t) => ({
        effective_from: t.effective_from,
        rate_pct: n(t.rate_pct),
        day_count: t.day_count,
        is_agreed: t.is_agreed,
      })),
      at,
    );

    // ── دفتر الاستثمار، لكلّ جولة ──
    const byRound = rounds.map((rd) => {
      const mine = invRows.filter((x) => x.round_id === rd.id);
      const contributed = r2(mine.filter((x) => x.direction === 'contribution').reduce((a, x) => a + n(x.amount_usd), 0));
      const repatAll = mine.filter((x) => x.direction === 'repatriation');
      const repatConfirmed = r2(repatAll.filter((x) => x.status === 'confirmed').reduce((a, x) => a + n(x.amount_usd), 0));
      const repatAnnounced = r2(repatAll.filter((x) => x.status !== 'confirmed').reduce((a, x) => a + n(x.amount_usd), 0));
      const commitment = n(rd.commitment_usd);
      /*
       * ما أقرضته الأمّ لهذه الجولة — من صفوف الدفتر مباشرةً.
       *
       * ولا يُطابَق بالتاريخ والمبلغ: شريحتان بالمبلغ نفسه في اليوم نفسه
       * تجعلان المطابقة تختار إحداهما مرّتين وتُسقط الأخرى.
       */
      const fundedForRound = r2(parentRows
        .filter((p) => p.round_id === rd.id && p.kind === 'principal' && p.direction === 'funding')
        .reduce((a, p) => a + n(p.amount_usd), 0));

      return {
        id: rd.id, round_no: rd.round_no, commitment, status: rd.status,
        plsa_signed_date: rd.plsa_signed_date, note: rd.note,
        contributed,
        contributed_pct: commitment ? r2((contributed / commitment) * 100) : 0,
        /*
         * التجاوز يُحسب ولا يُخفى.
         *
         * الجولة السابعة نودي فيها 1,272,500 على التزامٍ 1,250,000 — فمخالفةُ
         * بندٍ محتملة. وهو الرقم الذي كشف أنّ ثلاثة قيودٍ قد تكون للجولة الثامنة.
         */
        over_commitment: r2(Math.max(0, contributed - commitment)),
        repat_confirmed: repatConfirmed,
        repat_announced: repatAnnounced,
        net_confirmed: r2(contributed - repatConfirmed),
        net_if_all: r2(contributed - repatConfirmed - repatAnnounced),
        funded_by_parent: fundedForRound,
        /*
         * فجوةُ التمويل: ما استثمرته التابعة ولم تُقرضه الأمّ.
         * في الجولة السابعة 133,750 — وهي بالضبط القيود الثلاثة المشكوكة
         * ناقص 1,250 الذي يسمّيه المستند «غير جوهريّ».
         */
        unfunded_gap: r2(contributed - fundedForRound),
        suspect_count: mine.filter((x) => x.suspect_round_id).length,
        vessels: vesselRows.filter((v) => v.round_id === rd.id).length,
        fund_calls: callRows.filter((c) => c.round_id === rd.id).map((c) => ({
          as_of: c.as_of, fund_called_usd: n(c.fund_called_usd), pct: n(c.pct),
        })),
      };
    });

    const contributedAll = r2(byRound.reduce((a, r) => a + r.contributed, 0));
    const repatConfirmedAll = r2(byRound.reduce((a, r) => a + r.repat_confirmed, 0));
    const repatAnnouncedAll = r2(byRound.reduce((a, r) => a + r.repat_announced, 0));

    return {
      as_of: at,
      /*
       * الرؤوس الستّة التي طلبها المالك: كم اقتُرض، وكم استُثمر، وكم عاد،
       * وكم سُدّد، وما القائم، وما الفائدة.
       */
      summary: {
        borrowed_from_parent: funded,
        repaid_to_parent: repaid,
        outstanding_to_parent: r2(funded - repaid),
        invested_in_stone: contributedAll,
        returned_confirmed: repatConfirmedAll,
        returned_announced: repatAnnouncedAll,
        interest_accrued: interest.accrued,
        interest_paid: interest.paid,
        interest_outstanding: interest.outstanding,
        /** لا شرطَ مُدخَل ⇒ الشاشة تقول «لا فائدةَ مُتّفقٌ عليها» ولا تسكت */
        interest_has_terms: interest.hasTerms,
        interest_agreed: interest.agreed,
      },
      interest_slices: interest.slices,
      rounds: byRound,
      parent_ledger: parentRows,
      investment_ledger: invRows,
      bank_confirmations: bankRows,
      vessels: vesselRows,
      open_items: itemRows,
      interest_terms: termRows,
      alerts: this.alerts(byRound, repatAnnouncedAll, interest),
    };
  }

  /**
   * التنبيهات — تُشتقّ من الأرقام لا تُكتب يداً.
   *
   * فتنبيهٌ مكتوبٌ يبقى بعد أن يزول سببُه، ويُفقد الثقة في بقيّة اللوحة.
   */
  private alerts(
    rounds: { round_no: number; commitment: number; contributed: number; over_commitment: number; unfunded_gap: number; funded_by_parent: number; suspect_count: number }[],
    announced: number,
    interest: { hasTerms: boolean; agreed: boolean },
  ) {
    const out: { level: 'red' | 'amber' | 'yellow'; text: string }[] = [];

    for (const r of rounds) {
      if (r.contributed > 0 && r.funded_by_parent === 0) {
        out.push({ level: 'red', text: `الجولة ${r.round_no}: استُثمر ${r.contributed.toLocaleString('en-US')} ولم تُقرض الأمّ شيئاً — التسهيل لم يُنشأ` });
      } else if (r.unfunded_gap > 0) {
        out.push({ level: 'amber', text: `الجولة ${r.round_no}: ${r.unfunded_gap.toLocaleString('en-US')} استُثمرت بلا تمويلٍ مقابلٍ من الأمّ` });
      }
      if (r.over_commitment > 0) {
        out.push({ level: 'red', text: `الجولة ${r.round_no}: المنادى يتجاوز الالتزام بـ ${r.over_commitment.toLocaleString('en-US')}` });
      }
      if (r.suspect_count > 0) {
        out.push({ level: 'amber', text: `الجولة ${r.round_no}: ${r.suspect_count} قيداً مشكوكٌ في نسبته للجولة` });
      }
    }
    if (announced > 0) {
      out.push({ level: 'amber', text: `استردادٌ مُعلَنٌ لم يُؤكَّد وصوله: ${announced.toLocaleString('en-US')}` });
    }
    if (!interest.hasTerms) {
      out.push({ level: 'yellow', text: 'لا شروطَ فائدةٍ مُدخَلة — ولا فائدةَ مُتّفقٌ عليها' });
    } else if (!interest.agreed) {
      out.push({ level: 'yellow', text: 'الفائدة محسوبةٌ بشروطٍ غير موقَّعة — الرقم تقديريٌّ لا التزام' });
    }
    return out;
  }

  // ── الإضافة والتعديل ─────────────────────────────────────────────────────

  private requireDate(v: unknown, field: string): string {
    const s = String(v ?? '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new BadRequestException(`${field}: تاريخٌ غير صالح`);
    return s;
  }

  private requireAmount(v: unknown, field: string): number {
    const x = Number(v);
    if (!Number.isFinite(x) || x <= 0) throw new BadRequestException(`${field}: مبلغٌ موجبٌ مطلوب`);
    return r2(x);
  }

  private pick<T extends string>(allowed: readonly T[], v: unknown, field: string): T {
    if (!(allowed as readonly string[]).includes(String(v))) throw new BadRequestException(`${field}: قيمةٌ غير مقبولة`);
    return String(v) as T;
  }

  listRounds() { return this.rounds.find({ order: { round_no: 'ASC' } }); }

  async addRound(b: any) {
    const no = Number(b?.round_no);
    if (!Number.isInteger(no) || no <= 0) throw new BadRequestException('رقم الجولة مطلوب');
    if (await this.rounds.findOne({ where: { round_no: no } })) throw new BadRequestException('الجولة موجودةٌ سلفاً');
    return this.rounds.save(this.rounds.create({
      round_no: no,
      commitment_usd: String(this.requireAmount(b?.commitment_usd, 'الالتزام')),
      plsa_signed_date: b?.plsa_signed_date || null,
      status: String(b?.status || ''),
      note: String(b?.note || ''),
    }));
  }

  async addParentMove(b: any, user = '') {
    return this.parent.save(this.parent.create({
      occurred_at: this.requireDate(b?.occurred_at, 'التاريخ'),
      direction: this.pick(['funding', 'repayment'] as const, b?.direction, 'الاتّجاه'),
      kind: this.pick(['principal', 'interest'] as const, b?.kind ?? 'principal', 'النوع'),
      amount_usd: String(this.requireAmount(b?.amount_usd, 'المبلغ')),
      round_id: b?.round_id || null,
      reference: String(b?.reference || ''),
      note: String(b?.note || ''),
      created_by: user,
    }));
  }

  async addInvestmentMove(b: any, user = '') {
    const direction = this.pick(['contribution', 'repatriation'] as const, b?.direction, 'الاتّجاه');
    if (!b?.round_id) throw new BadRequestException('الجولة مطلوبة');
    if (!(await this.rounds.findOne({ where: { id: String(b.round_id) } }))) throw new NotFoundException('الجولة غير موجودة');
    const call = b?.call_date ? this.requireDate(b.call_date, 'تاريخ النداء') : null;
    const paid = b?.paid_date ? this.requireDate(b.paid_date, 'تاريخ الدفع') : null;
    // القيد بلا تاريخٍ لا موضعَ له في الزمن — والقاعدة تحرسه، ونحرسه قبلها
    if (!call && !paid) throw new BadRequestException('تاريخُ نداءٍ أو دفعٍ مطلوبٌ على الأقلّ');

    return this.inv.save(this.inv.create({
      round_id: String(b.round_id),
      direction,
      seq: b?.seq != null ? Number(b.seq) : null,
      call_date: call,
      paid_date: paid,
      amount_usd: String(this.requireAmount(b?.amount_usd, 'المبلغ')),
      pct_of_commitment: b?.pct_of_commitment != null ? String(Number(b.pct_of_commitment)) : null,
      ships: String(b?.ships || ''),
      source: this.pick(['stone_recap', 'bee_gl', 'both'] as const, b?.source ?? 'both', 'المصدر'),
      // الحالة للاسترداد وحده — والمساهمة لا تحملها
      status: direction === 'repatriation'
        ? this.pick(['announced', 'confirmed'] as const, b?.status ?? 'announced', 'الحالة')
        : null,
      suspect_round_id: b?.suspect_round_id || null,
      note: String(b?.note || ''),
      created_by: user,
    }));
  }

  async addBankConfirmation(b: any, user = '') {
    return this.banks.save(this.banks.create({
      occurred_at: this.requireDate(b?.occurred_at, 'التاريخ'),
      bank: String(b?.bank || ''),
      reference: String(b?.reference || ''),
      amount_usd: b?.amount_usd != null ? String(this.requireAmount(b.amount_usd, 'المبلغ')) : null,
      links_table: b?.links_table
        ? this.pick(['parent_ledger', 'investment_ledger'] as const, b.links_table, 'الربط')
        : null,
      links_id: b?.links_id || null,
      note: String(b?.note || ''),
      created_by: user,
    }));
  }

  async addFundCall(b: any) {
    if (!b?.round_id) throw new BadRequestException('الجولة مطلوبة');
    return this.calls.save(this.calls.create({
      round_id: String(b.round_id),
      as_of: this.requireDate(b?.as_of, 'التاريخ'),
      fund_called_usd: b?.fund_called_usd != null ? String(Number(b.fund_called_usd)) : null,
      pct: b?.pct != null ? String(Number(b.pct)) : null,
      note: String(b?.note || ''),
    }));
  }

  async addVessel(b: any) {
    if (!String(b?.name || '').trim()) throw new BadRequestException('اسم السفينة مطلوب');
    return this.vessels.save(this.vessels.create({
      round_id: b?.round_id || null,
      name: String(b.name).trim(),
      vessel_type: String(b?.vessel_type || ''),
      built: b?.built != null ? Number(b.built) : null,
      hire: String(b?.hire || ''),
      charter_period: String(b?.charter_period || ''),
      delivery: String(b?.delivery || ''),
      pool_coefficient: String(b?.pool_coefficient || ''),
      note: String(b?.note || ''),
    }));
  }

  async addOpenItem(b: any) {
    if (!String(b?.title || '').trim()) throw new BadRequestException('عنوان البند مطلوب');
    return this.items.save(this.items.create({
      title: String(b.title).trim(),
      status: this.pick(['open', 'sent', 'closed'] as const, b?.status ?? 'open', 'الحالة'),
      owner: String(b?.owner || ''),
      due_date: b?.due_date || null,
      note: String(b?.note || ''),
      sort_order: b?.sort_order != null ? Number(b.sort_order) : 0,
    }));
  }

  async setOpenItemStatus(id: string, status: string) {
    const row = await this.items.findOne({ where: { id } });
    if (!row) throw new NotFoundException('البند غير موجود');
    row.status = this.pick(['open', 'sent', 'closed'] as const, status, 'الحالة');
    row.closed_date = row.status === 'closed' ? new Date().toISOString().slice(0, 10) : null;
    row.updated_at = new Date();
    return this.items.save(row);
  }

  async addInterestTerm(b: any, user = '') {
    const rate = Number(b?.rate_pct);
    if (!Number.isFinite(rate) || rate < 0) throw new BadRequestException('النسبة مطلوبة');
    return this.terms.save(this.terms.create({
      effective_from: this.requireDate(b?.effective_from, 'تاريخ البدء'),
      rate_pct: String(rate),
      day_count: this.pick(['ACT/365', 'ACT/360'] as const, b?.day_count ?? 'ACT/365', 'الأساس'),
      is_agreed: b?.is_agreed === true,
      note: String(b?.note || ''),
      created_by: user,
    }));
  }

  // ── البذر ────────────────────────────────────────────────────────────────

  /**
   * خطّةُ بذرٍ — تُحسب وتُعرض **ولا تكتب شيئاً**.
   *
   * والحمولة تصل في جسم الطلب لا من ملفٍّ في المستودع: المستودع عامٌّ، وأرقام
   * قرضٍ بين شركةٍ أمٍّ وتابعتها لا تُنشر.
   */
  async seedPlan(payload: SeedPayload): Promise<SeedPlan & { tables_empty: boolean; existing: number }> {
    const plan = planSeed(payload);
    const existing = await this.totalRows();
    return { ...plan, tables_empty: existing === 0, existing };
  }

  private async totalRows(): Promise<number> {
    const counts = await Promise.all([
      this.rounds.count(), this.parent.count(), this.inv.count(), this.banks.count(),
      this.calls.count(), this.vessels.count(), this.items.count(), this.terms.count(),
    ]);
    return counts.reduce((a, b) => a + b, 0);
  }

  /**
   * الكتابة — مرّةً واحدةً على دفترٍ فارغ.
   *
   * ── ولماذا يرفض التكرار ──
   * البذر يُجرى مرّةً. وإعادتُه على دفترٍ فيه بياناتٌ تُضاعف كلّ قيد، ولا يُكتشف
   * ذلك إلا بجمعٍ يدويّ. والحذف قبل البذر قرارٌ يُتّخذ صراحةً لا ضمناً.
   *
   * وما لا يمرّ الخطّة لا يُكتب: `ok = false` يعني خطأً يمنع.
   */
  async seedCommit(payload: SeedPayload, user = '') {
    const plan = planSeed(payload);
    if (!plan.ok) {
      throw new BadRequestException(
        'الخطّة فيها أخطاء: ' + plan.findings.filter((f) => f.level === 'error').map((f) => f.text).join(' · '),
      );
    }
    const existing = await this.totalRows();
    if (existing > 0) {
      throw new BadRequestException(`الدفتر ليس فارغاً (${existing} صفّاً) — البذر يُجرى مرّةً واحدة`);
    }

    // ١ · الجولات أوّلاً، فبها تُنسَب البقيّة
    const roundIds = new Map<number, string>();
    for (const r of payload.rounds) {
      const row = await this.rounds.save(this.rounds.create({
        round_no: r.round_no,
        commitment_usd: String(r2(Number(r.commitment_usd))),
        plsa_signed_date: r.plsa_signed_date || null,
        status: String(r.status || ''),
        note: String(r.note || ''),
      }));
      roundIds.set(r.round_no, row.id);
    }
    const rid = (no?: number | null) => (no != null ? roundIds.get(no) ?? null : null);

    for (const m of payload.parent ?? []) {
      await this.parent.save(this.parent.create({
        occurred_at: m.occurred_at,
        direction: m.direction,
        kind: m.kind ?? 'principal',
        amount_usd: String(r2(Number(m.amount_usd))),
        round_id: rid(m.round_no),
        reference: String(m.reference || ''),
        note: String(m.note || ''),
        created_by: user,
      }));
    }

    for (const m of payload.investment ?? []) {
      await this.inv.save(this.inv.create({
        round_id: rid(m.round_no)!,
        direction: m.direction,
        seq: m.seq ?? null,
        call_date: m.call_date || null,
        paid_date: m.paid_date || null,
        amount_usd: String(r2(Number(m.amount_usd))),
        // النسبة تُشتقّ ولا تُنقل: رقمٌ منقولٌ قد يخالف مبلغه
        pct_of_commitment: (() => {
          const c = payload.rounds.find((x) => x.round_no === m.round_no)?.commitment_usd;
          return c ? String(Number(m.amount_usd) / Number(c)) : null;
        })(),
        ships: String(m.ships || ''),
        source: m.source ?? 'both',
        status: m.direction === 'repatriation' ? (m.status ?? 'announced') : null,
        suspect_round_id: rid(m.suspect_round_no),
        note: String(m.note || ''),
        created_by: user,
      }));
    }

    for (const b of payload.bank ?? []) {
      await this.banks.save(this.banks.create({
        occurred_at: b.occurred_at,
        bank: String(b.bank || ''),
        reference: String(b.reference || ''),
        amount_usd: b.amount_usd != null ? String(r2(Number(b.amount_usd))) : null,
        note: String(b.note || ''),
        created_by: user,
      }));
    }

    for (const c of payload.fund_calls ?? []) {
      await this.calls.save(this.calls.create({
        round_id: rid(c.round_no)!,
        as_of: c.as_of,
        fund_called_usd: c.fund_called_usd != null ? String(Number(c.fund_called_usd)) : null,
        pct: c.pct != null ? String(Number(c.pct)) : null,
        note: String(c.note || ''),
      }));
    }

    for (const v of payload.vessels ?? []) {
      await this.vessels.save(this.vessels.create({
        round_id: rid(v.round_no),
        name: v.name,
        vessel_type: String(v.vessel_type || ''),
        built: v.built ?? null,
        hire: String(v.hire || ''),
        charter_period: String(v.charter_period || ''),
        delivery: String(v.delivery || ''),
        pool_coefficient: String(v.pool_coefficient || ''),
        note: String(v.note || ''),
      }));
    }

    let order = 0;
    for (const it of payload.open_items ?? []) {
      await this.items.save(this.items.create({
        title: it.title,
        status: it.status ?? 'open',
        owner: String(it.owner || ''),
        note: String(it.note || ''),
        sort_order: order++,
      }));
    }

    return { seeded: true, plan, written: await this.totalRows() };
  }

  /** حذفُ قيدٍ — بمعرّفه ودفتره. ولا حذفَ جماعيّ. */
  async removeRow(table: string, id: string) {
    const repo: Record<string, Repository<any>> = {
      parent_ledger: this.parent,
      investment_ledger: this.inv,
      bank_confirmations: this.banks,
      fund_calls: this.calls,
      vessels: this.vessels,
      open_items: this.items,
      interest_terms: this.terms,
      rounds: this.rounds,
    };
    const r = repo[table];
    if (!r) throw new BadRequestException('دفترٌ غير معروف');
    const row = await r.findOne({ where: { id } });
    if (!row) throw new NotFoundException('القيد غير موجود');
    await r.delete({ id });
    return { deleted: true };
  }
}
