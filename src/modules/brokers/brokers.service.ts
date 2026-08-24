import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { Broker, BrokerRule, BrokerLedger } from './broker.entity';
import { HireInvoice } from '../hire-invoices/hire-invoice.entity';

/**
 * عمولة البروكر على فواتير الإيجار.
 *
 * ── القاعدة، بقرار المالك في ٢٤ أغسطس ٢٠٢٦ ──
 * كلّ فاتورة إيجارٍ تُصدَر إلى `Africa Morocco Links S.A` عن `Wasa Express`
 * أو `Monte Express` يستحقّ عليها بروكران ١.٢٥٪ لكلٍّ من **إجماليها**:
 * `Hammer Ship` و`Stena RORO`.
 *
 *   · الاستحقاق **عند الإصدار** لا عند التحصيل.
 *   · **والإشعارات الدائنة لا تُنقصه** — نصّاً: «لا علاقة لها بالأمر».
 *   · وتسري على ما يُصدَر من اليوم، وعلى أيّ فاتورةٍ قديمة **تُعدَّل**.
 *
 * ── وأين تعيش القاعدة ──
 * في `broker_rules` لا في هذا الملفّ: العميل والمركب والنسبة بياناتٌ تتغيّر
 * بلا نشر. وهذه الخدمة تقرأها وتُطبّقها.
 */
@Injectable()
export class BrokersService {
  constructor(
    @InjectRepository(Broker) private brokers: Repository<Broker>,
    @InjectRepository(BrokerRule) private rules: Repository<BrokerRule>,
    @InjectRepository(BrokerLedger) private ledger: Repository<BrokerLedger>,
    @InjectRepository(HireInvoice) private invoices: Repository<HireInvoice>,
  ) {}

  private r2 = (v: unknown) => Math.round((Number(v) || 0) * 100) / 100;

  /** ما دون هذا تدويرٌ لا مبلغ. */
  static readonly TOLERANCE = 0.01;

  // ── القواعد ─────────────────────────────────────────────────────────────

  listBrokers() {
    return this.brokers.find({ order: { name: 'ASC' } });
  }

  async listRules() {
    const rows = await this.rules.find();
    const brokers = await this.brokers.find();
    const byId = new Map(brokers.map((b) => [b.id, b.name]));
    return rows.map((r) => ({ ...r, rate: Number(r.rate), broker_name: byId.get(r.broker_id) || '—' }));
  }

  /**
   * القواعد المنطبقة على فاتورة.
   *
   * والمركبُ الفارغ في القاعدة يعني «كلّ مراكب هذا العميل» — فيُطابَق العميل
   * وحده. وهذا يجعل إضافة مركبٍ ثالثٍ لاحقاً بلا عمل.
   */
  private async rulesFor(inv: HireInvoice): Promise<BrokerRule[]> {
    const all = await this.rules.find({ where: { customer_id: inv.customer_id, active: true } });
    return all.filter((r) => !r.vessel_id || r.vessel_id === inv.vessel_id);
  }

  // ── الاستحقاق ───────────────────────────────────────────────────────────

  /**
   * يُزامن استحقاقات فاتورةٍ بعد حفظها.
   *
   * ── لماذا «يُزامن» لا «يُضيف» ──
   * الفاتورة تُعدَّل: يتغيّر إجماليها أو مركبها أو عميلها. فلو أُضيف قيدٌ في كلّ
   * حفظٍ لتضاعف الاستحقاق. والقيد **واحدٌ لكلّ (فاتورة · بروكر)** — يُنشأ أو
   * يُحدَّث، ويُحذف إن لم تعد القاعدة تنطبق.
   *
   * ── وما لا يُمسّ ──
   * استحقاقٌ سُدِّد عنه شيءٌ **لا يُحذف** ولو زالت القاعدة: مالٌ خرج، وحذفُه
   * يُنكره. فيُترك ويُعلَن.
   *
   * ── والإشعارات ──
   * `doc_type` غير `invoice` لا يُولّد شيئاً — لا الدائن ولا المدين.
   */
  async syncInvoice(invoiceId: string, user = ''): Promise<{ created: number; updated: number; removed: number; kept: number }> {
    const inv = await this.invoices.findOne({ where: { id: invoiceId } });
    if (!inv) return { created: 0, updated: 0, removed: 0, kept: 0 };

    const existing = await this.ledger.find({
      where: { hire_invoice_id: invoiceId, kind: 'due' },
    });
    const rules = inv.doc_type === 'invoice' ? await this.rulesFor(inv) : [];

    let created = 0, updated = 0, removed = 0, kept = 0;
    const wanted = new Set(rules.map((r) => r.broker_id));

    for (const r of rules) {
      const base = this.r2(inv.total_amount);
      const amount = this.r2((base * Number(r.rate)) / 100);
      const cur = existing.find((e) => e.broker_id === r.broker_id);

      if (!cur) {
        if (Math.abs(amount) <= BrokersService.TOLERANCE) continue;
        await this.ledger.save(this.ledger.create({
          broker_id: r.broker_id,
          hire_invoice_id: inv.id,
          occurred_at: inv.invoice_date ? new Date(inv.invoice_date) : new Date(),
          kind: 'due',
          amount,
          currency: inv.currency || r.currency,
          base_amount: base,
          rate: Number(r.rate),
          reference: inv.invoice_number,
          note: `عمولة عن فاتورة ${inv.invoice_number}`,
          created_by: user,
        }));
        created++;
      } else if (
        Math.abs(Number(cur.amount) - amount) > BrokersService.TOLERANCE
        || Math.abs(Number(cur.base_amount) - base) > BrokersService.TOLERANCE
      ) {
        cur.amount = amount;
        cur.base_amount = base;
        cur.rate = Number(r.rate);
        cur.currency = inv.currency || r.currency;
        cur.reference = inv.invoice_number;
        await this.ledger.save(cur);
        updated++;
      } else {
        kept++;
      }
    }

    // استحقاقاتٌ لم تعد قاعدتها منطبقة
    for (const e of existing) {
      if (wanted.has(e.broker_id)) continue;
      const paid = await this.ledger.count({
        where: { hire_invoice_id: invoiceId, broker_id: e.broker_id, kind: 'payment' },
      });
      if (paid > 0) { kept++; continue; }   // سُدِّد عنه — لا يُحذف
      await this.ledger.delete({ id: e.id });
      removed++;
    }

    return { created, updated, removed, kept };
  }

  // ── السداد ──────────────────────────────────────────────────────────────

  /**
   * سدادٌ لبروكر — يُقيَّد سالباً دائماً.
   *
   * فمن يكتب ٣٬٤٨٧.٥٠ يقصد دفعها، لا أن يزيد ما له. وقد يُنسب إلى فاتورةٍ
   * بعينها فيُقفل استحقاقها، أو يُترك عامّاً على الحساب.
   */
  async pay(
    input: { brokerId: string; amount: number; invoiceId?: string | null; reference?: string; note?: string },
    user = '',
  ) {
    const broker = await this.brokers.findOne({ where: { id: String(input?.brokerId || '') } });
    if (!broker) throw new NotFoundException('البروكر غير موجود');

    const raw = Number(input?.amount);
    if (!Number.isFinite(raw) || Math.abs(raw) <= BrokersService.TOLERANCE) {
      throw new BadRequestException('مبلغ السداد مطلوب');
    }

    let invoiceId: string | null = null;
    let currency = 'EUR';
    if (input.invoiceId) {
      const inv = await this.invoices.findOne({ where: { id: input.invoiceId } });
      if (!inv) throw new NotFoundException('الفاتورة غير موجودة');
      invoiceId = inv.id;
      currency = inv.currency || 'EUR';
    }

    const saved = await this.ledger.save(this.ledger.create({
      broker_id: broker.id,
      hire_invoice_id: invoiceId,
      occurred_at: new Date(),
      kind: 'payment',
      amount: -Math.abs(this.r2(raw)),
      currency,
      base_amount: 0,
      rate: 0,
      reference: String(input.reference || '').trim(),
      note: String(input.note || '').trim() || 'سدادٌ للبروكر',
      created_by: user,
    }));

    return { entry: saved, account: await this.account(broker.id) };
  }

  /**
   * حذفُ سدادٍ أُدخل خطأً — بسببٍ مكتوب.
   *
   * والسداد واقعةٌ لا حساب: حذفه يعني أنّ الدفع لم يجرِ أصلاً. ولا يُحذف
   * استحقاقٌ بهذا الطريق — الاستحقاق يتبع الفاتورة، فيُزامن معها.
   */
  async deletePayment(id: string, reason: string, user = '') {
    const why = String(reason || '').trim();
    if (!why) throw new BadRequestException('حذفُ سدادٍ يستوجب سبباً مكتوباً');
    const e = await this.ledger.findOne({ where: { id } });
    if (!e) throw new NotFoundException('القيد غير موجود');
    if (e.kind !== 'payment') {
      throw new BadRequestException('لا يُحذف إلا قيدُ سداد — والاستحقاق يتبع فاتورته');
    }
    await this.ledger.delete({ id });
    // eslint-disable-next-line no-console
    console.warn(`[broker] حُذف سدادٌ ${e.broker_id} ${e.amount} · ${user} · ${why}`);
    return { deleted: true, account: await this.account(e.broker_id) };
  }

  // ── كشف الحساب ──────────────────────────────────────────────────────────

  /**
   * كشفُ حسابٍ لبروكر — الأقدم أوّلاً وبرصيدٍ متحرّك.
   *
   * والرصيد يُحسب هنا لا في الشاشة: لو حسبته الشاشة لاختلف باختلاف ترتيبها
   * أو ترشيحها، وصار لكلّ عرضٍ رصيد.
   */
  async account(brokerId: string) {
    const broker = await this.brokers.findOne({ where: { id: brokerId } });
    if (!broker) throw new NotFoundException('البروكر غير موجود');

    const rows = await this.ledger.find({
      where: { broker_id: brokerId },
      order: { occurred_at: 'ASC', created_at: 'ASC' },
    });

    const invIds = [...new Set(rows.map((r) => r.hire_invoice_id).filter(Boolean) as string[])];
    const invs = invIds.length
      ? await this.invoices.find({ where: { id: In(invIds) }, relations: { vessel: true } })
      : [];
    const byId = new Map(invs.map((i) => [i.id, i]));

    let running = 0;
    let totalDue = 0;
    let totalPaid = 0;
    const entries = rows.map((e) => {
      const amount = this.r2(e.amount);
      running = this.r2(running + amount);
      if (e.kind === 'due') totalDue = this.r2(totalDue + amount);
      if (e.kind === 'payment') totalPaid = this.r2(totalPaid - amount);
      const inv = e.hire_invoice_id ? byId.get(e.hire_invoice_id) : null;
      return {
        ...e,
        amount,
        base_amount: this.r2(e.base_amount),
        rate: Number(e.rate),
        running,
        invoice_number: inv?.invoice_number || null,
        invoice_date: inv?.invoice_date || null,
        vessel_name: inv?.vessel?.name || null,
      };
    });

    return {
      broker: { id: broker.id, name: broker.name, active: broker.active },
      entries,
      balance: running,
      totalDue,
      totalPaid,
    };
  }

  /** كشوف البروكرين معاً — لصفحةٍ واحدة وبطاقةٍ في رأس فواتير الإيجار. */
  async allAccounts() {
    const brokers = await this.brokers.find({ order: { name: 'ASC' } });
    const accounts: Awaited<ReturnType<BrokersService['account']>>[] = [];
    for (const b of brokers) accounts.push(await this.account(b.id));
    return {
      accounts,
      totalOutstanding: this.r2(accounts.reduce((a, x) => a + x.balance, 0)),
    };
  }

  /**
   * ملخّصٌ لكلّ فاتورة — للشارة في القائمة.
   *
   * يُرجع خريطةً: معرّف الفاتورة ← { المستحقّ · المسدَّد · المتبقّي }.
   * وتُحسب في استعلامٍ واحد لا استعلامٍ لكلّ صفّ.
   */
  async invoiceSummary() {
    const rows = await this.ledger
      .createQueryBuilder('l')
      .select('l.hire_invoice_id', 'id')
      .addSelect(`COALESCE(SUM(CASE WHEN l.kind = 'due' THEN l.amount ELSE 0 END), 0)`, 'due')
      .addSelect(`COALESCE(SUM(CASE WHEN l.kind = 'payment' THEN -l.amount ELSE 0 END), 0)`, 'paid')
      .where('l.hire_invoice_id IS NOT NULL')
      .groupBy('l.hire_invoice_id')
      .getRawMany<{ id: string; due: string; paid: string }>();

    const out: Record<string, { due: number; paid: number; outstanding: number }> = {};
    for (const r of rows) {
      const due = this.r2(r.due);
      const paid = this.r2(r.paid);
      out[r.id] = { due, paid, outstanding: this.r2(due - paid) };
    }
    return out;
  }
}
