import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Not, IsNull } from 'typeorm';
import { ProfitPeriod } from './profit-period.entity';
import {
  ProfitSettlement, PARTNERS, PARTNER_NAMES, Partner,
} from './profit-settlement.entity';
import { ModelResult, ProposedResult } from './profit-model';

/**
 * ما تُصادَق عليه فترة — ناتج المحرّكين معاً.
 *
 * `distribution` سلسلة المستند: منها اكتمالُ المدخلات وحصص الأعباء وأثر
 * الشراكة. و`proposed` هي **الطريقة المعتمدة للمصادقة** بقرار المالك في
 * ٢٤ أغسطس ٢٠٢٦ — ومنها يخرج الرقم الذي يُحوَّل إلى البنك.
 *
 * ويُحفظان معاً في اللقطة: الرقم من الثانية، والسياق من الأولى.
 */
export interface Ratifiable {
  distribution: ModelResult;
  proposed: ProposedResult;
}

/**
 * المصادقة والرصيد التراكميّ.
 *
 * ── المشكلة التي يحلّها ──
 * التوزيع يصدر وفي مصاريفه **مبالغ تقديريّة**: رسوم ميناء مصر تُكتب ١١٬٥٠٠
 * في كلّ رحلة حتّى تصل الفاتورة. فالمُحوَّل إلى البنك صدر على تقدير، ثمّ يتغيّر
 * الشيت حين يصير التقدير فعلاً — والتوزيع قد نُفّذ.
 *
 * ── الحلّ ──
 *   ١ · المصادقة تُجمّد الرقم المُحوَّل وتُقفل الفترة.
 *   ٢ · السحب الجديد يستقرّ في `latest_snapshot` ولا يدهس المُجمَّد.
 *   ٣ · الفرق يُقيَّد في دفتر الفروق باسم الشريك.
 *   ٤ · والمصادقة التالية تحمل الرصيد المعلّق فتُصفّره.
 *
 * ── لماذا دفترٌ لا رقم ──
 * الرصيد الجاري يُسأل عنه بعد سنة: «من أين جاء هذا؟». فكلّ فرقٍ قيدٌ بتاريخه
 * وفترته، وتسويته قيدٌ مقابل. ورقمٌ واحدٌ يُكتب فوقه يُجيب «لا أدري».
 */
@Injectable()
export class ProfitRatificationService {
  constructor(
    @InjectRepository(ProfitPeriod) private periods: Repository<ProfitPeriod>,
    @InjectRepository(ProfitSettlement) private ledger: Repository<ProfitSettlement>,
  ) {}

  private r2 = (v: number) => Math.round((Number(v) || 0) * 100) / 100;

  /** ما دون هذا تدويرٌ لا فرق — كسائر حرّاس النظام. */
  static readonly TOLERANCE = 0.02;

  /**
   * الرصيد الجاري لكلّ شريك = مجموع قيوده.
   *
   * وليس رقماً مخزَّناً بل مشتقّاً — فلا يفترق عن الدفتر أبداً.
   */
  async balances(): Promise<Record<Partner, number>> {
    const rows = await this.ledger
      .createQueryBuilder('s')
      .select('s.partner', 'partner')
      .addSelect('COALESCE(SUM(s.amount), 0)', 'total')
      .groupBy('s.partner')
      .getRawMany<{ partner: string; total: string }>();

    const out = { badawi: 0, ittihad: 0 } as Record<Partner, number>;
    for (const r of rows) {
      if ((PARTNERS as readonly string[]).includes(r.partner)) {
        out[r.partner as Partner] = this.r2(Number(r.total));
      }
    }
    return out;
  }

  /**
    * التحويلات المُصادَق عليها — حركةُ المال الفعليّة.
    *
    * ── لماذا لا يكفي دفتر الفروق ──
    * الدفتر يقيّد **التصحيحات** وحدها، ومتى سُوّيت عاد صفراً. فمن ينظر إليه
    * يرى «لا شيء معلّق» — وهو صحيح، لكنّه لا يقول كم حُوِّل ولا كم تراكم.
    *
    * والمالك سأل: «أتابع الفلوس بتاعتي زادت ولا نقصت». فهذا جوابه: كلّ فترةٍ
    * صُودق عليها، والمحسوب والمحمول والمُحوَّل فيها، ومجموعُ ما حُوِّل لكلّ شريك.
    */
  async transfers() {
    const rows = await this.periods.find({
      where: { ratified_at: Not(IsNull()) },
      order: { date_from: 'ASC' },
    });

    const running = { badawi: 0, ittihad: 0 } as Record<Partner, number>;
    const list = rows.map((p) => {
      const snap = (p.ratified_snapshot || {}) as any;
      const paid = (snap.transferPaid || {}) as Record<Partner, number>;
      for (const k of PARTNERS) running[k] = this.r2(running[k] + (Number(paid[k]) || 0));
      return {
        id: p.id,
        period_name: p.period_name,
        date_from: p.date_from,
        date_to: p.date_to,
        at: p.ratified_at,
        by: p.ratified_by,
        computed: snap.computedTransfer || null,
        carriedIn: snap.carriedIn || null,
        paid: paid || null,
        runningPaid: { ...running },
      };
    });

    return { list, totalPaid: { ...running } };
  }

  /**
   * كشف حسابٍ جارٍ لكلّ شريك — الأقدم أوّلاً، وبرصيدٍ متحرّك.
   *
   * ── لماذا الأقدم أوّلاً ──
   * الرصيد المتحرّك لا يُقرأ إلا بترتيبٍ زمنيّ صاعد: كلّ سطرٍ يقول «صار الرصيد
   * كذا بعد هذه الواقعة». وقلبُ الترتيب يجعل العمود الأخير لغزاً.
   *
   * ── وما فيه ──
   *   `له`     ما زاد على ما نحن مدينون به — استحقاقٌ أو فرقٌ لصالحه
   *   `عليه`   ما أنقصه — تحويلٌ خرج، أو فرقٌ عليه
   *   `الرصيد` موجبٌ يعني **مستحقٌّ لم يُدفع بعد**
   */
  async statement() {
    const entries = await this.ledger.find({ order: { occurred_at: 'ASC', created_at: 'ASC' } });
    const ids = [...new Set(entries.map((e) => e.period_id).filter(Boolean) as string[])];
    const names: Record<string, string> = {};
    if (ids.length) {
      const ps = await this.periods.find({ where: ids.map((id) => ({ id })) });
      for (const p of ps) names[p.id] = p.period_name;
    }
    /*
     * الرصيد المتحرّك يُحسب هنا لا في الشاشة.
     *
     * فلو حسبته الشاشة لاختلف باختلاف ترتيبها أو ترشيحها، وصار لكلّ عرضٍ
     * رصيدٌ. والحساب واحدٌ ومصدره الخادم.
     */
    const accounts: Record<string, {
      entries: any[]; balance: number;
      totalDue: number; totalPaid: number; opening: number;
    }> = {};
    for (const p of PARTNERS) {
      let running = 0;
      let due = 0;
      let paid = 0;
      let opening = 0;
      const rows = entries.filter((e) => e.partner === p).map((e) => {
        const amount = this.r2(Number(e.amount));
        running = this.r2(running + amount);
        if (e.kind === 'due') due = this.r2(due + amount);
        if (e.kind === 'payment') paid = this.r2(paid - amount);
        if (e.kind === 'opening') opening = this.r2(opening + amount);
        return {
          ...e,
          amount,
          running,
          period_name: e.period_id ? (names[e.period_id] || '—') : null,
        };
      });
      accounts[p] = { entries: rows, balance: running, totalDue: due, totalPaid: paid, opening };
    }

    return {
      balances: await this.balances(),
      partnerNames: PARTNER_NAMES,
      accounts,
      transfers: await this.transfers(),
      hasOpening: entries.some((e) => e.kind === 'opening'),
      /*
       * الافتتاحيّ يُعدَّل ما لم يُستهلك.
       *
       * ما دامت لم تُصادَق فترةٌ بعد فهو مسوّدة: لم يُبنَ عليه تحويل، ولم
       * يُقفله قيدُ تسوية. وتصحيح غلطةٍ في فاصلةٍ عشريّة بقيدٍ مقابل يُبقي
       * ٣٬٤٩٥٬٠٤٤ في الدفتر إلى الأبد لا معنى له.
       *
       * فإذا صُودق على فترةٍ واحدة، جُمِّد — وصار التصحيح بقيدٍ مقابل، لأنّ
       * حوالةً بُنيت عليه.
       */
      openingEditable: (await this.periods.count({ where: { ratified_at: Not(IsNull()) } })) === 0,
      opening: Object.fromEntries(
        entries.filter((e) => e.kind === 'opening')
          .map((e) => [e.partner, this.r2(Number(e.amount))]),
      ),
      entries: entries.map((e) => ({
        ...e,
        amount: this.r2(Number(e.amount)),
        period_name: e.period_id ? (names[e.period_id] || '—') : 'رصيدٌ افتتاحيّ',
      })),
    };
  }

  /**
   * الرصيد الافتتاحيّ — ما تراكم قبل أن يوجد النظام.
   *
   * يُقيَّد بلا فترة، لأنّه لا يخصّ فترة. وموجبٌ لصالح الشريك، وسالبٌ عليه —
   * والشاشة تكتب المعنى بالكلمات قبل الحفظ، فالإشارة تُراجَع بالعين لا بالظنّ.
   *
   * ولا يُكتب مرّتين: وجودُ قيدٍ افتتاحيٍّ لشريكٍ يمنع ثانياً له. فالافتتاح
   * يقع مرّةً واحدة بطبيعته، وتكراره يُضاعف رصيداً بلا أن يُلاحَظ.
   */
  async openBalance(
    entries: { partner: string; amount: number; note?: string }[],
    user: string,
  ) {
    const ratifiedCount = await this.periods.count({ where: { ratified_at: Not(IsNull()) } });
    if (ratifiedCount > 0) {
      throw new BadRequestException(
        'صُودق على فترةٍ بُنيت على هذا الرصيد — فلا يُعدَّل الافتتاحيّ بعدها، والتصحيح بقيدٍ مقابل',
      );
    }

    /*
     * يُستبدل لا يُضاف.
     *
     * فما دام لم يُستهلك فهو مسوّدة، والكتابة الثانية تصحيحٌ للأولى لا قيدٌ
     * ثانٍ. ولو أُضيف لتضاعف الرصيد بلا أن يُلاحَظ.
     */
    await this.ledger.delete({ kind: 'opening' });

    const at = new Date();
    const written: string[] = [];

    for (const e of entries || []) {
      const p = String(e.partner || '') as Partner;
      if (!(PARTNERS as readonly string[]).includes(p)) {
        throw new BadRequestException(`شريكٌ غير معروف: ${e.partner}`);
      }
      const amount = this.r2(Number(e.amount));
      if (!Number.isFinite(amount)) {
        throw new BadRequestException('مبلغٌ غير رقميّ');
      }
      if (Math.abs(amount) <= ProfitRatificationService.TOLERANCE) continue;

      await this.ledger.save(this.ledger.create({
        period_id: null,
        occurred_at: at,
        partner: p,
        amount,
        kind: 'opening',
        note: String(e.note || '').trim() || 'رصيدٌ افتتاحيّ — ما تراكم قبل أوّل مصادقة',
        created_by: user,
      }));
      written.push(p);
    }

    return { written, balances: await this.balances() };
  }

  /**
   * تحويلٌ فعليّ إلى الحساب البنكيّ — يُقيَّد يداً.
   *
   * ── لماذا يداً ──
   * المستحقّ لا يُحوَّل كلّه دائماً، بقرار المالك. فالمصادقة تقول «كم استُحقّ»،
   * وهذا يقول «كم خرج». وما بينهما يبقى رصيداً في الحساب الجاري.
   *
   * ويُقيَّد سالباً لأنّه يُنقص ما لنا عليه — والرصيد الموجب يعني مستحقّاً
   * لم يُدفع بعد.
   */
  async recordPayment(
    input: { partner: string; amount: number; note?: string; periodId?: string | null },
    user: string,
  ) {
    const p = String(input?.partner || '') as Partner;
    if (!(PARTNERS as readonly string[]).includes(p)) {
      throw new BadRequestException(`شريكٌ غير معروف: ${input?.partner}`);
    }
    const raw = Number(input?.amount);
    if (!Number.isFinite(raw) || Math.abs(raw) <= ProfitRatificationService.TOLERANCE) {
      throw new BadRequestException('مبلغُ التحويل مطلوب');
    }
    /*
     * يُقبل موجباً أو سالباً ويُخزَّن سالباً دائماً.
     * فمن يكتب ٤٨٦٬٧٣٣.٨١ يقصد تحويلها، لا أن يزيد الرصيد بها.
     */
    const amount = -Math.abs(this.r2(raw));

    let periodId: string | null = null;
    if (input.periodId) {
      const per = await this.periods.findOne({ where: { id: input.periodId } });
      if (!per) throw new NotFoundException('الفترة غير موجودة');
      periodId = per.id;
    }

    const saved = await this.ledger.save(this.ledger.create({
      period_id: periodId,
      occurred_at: new Date(),
      partner: p,
      amount,
      kind: 'payment',
      note: String(input.note || '').trim() || 'تحويلٌ إلى الحساب البنكيّ',
      created_by: user,
    }));

    return { entry: saved, balances: await this.balances() };
  }

  /**
   * حذفُ قيدِ تحويلٍ أُدخل خطأً.
   *
   * والتحويل واقعةٌ لا حساب — فحذفه يعني أنّ الحوالة لم تجرِ أصلاً، لا أنّها
   * جرت ثمّ رُدّت. ولهذا يُحذف ولا يُعكس، ويستوجب سبباً يُكتب في السجلّ.
   */
  async deletePayment(id: string, reason: string, user: string) {
    const why = String(reason || '').trim();
    if (!why) throw new BadRequestException('حذفُ تحويلٍ يستوجب سبباً مكتوباً');
    const e = await this.ledger.findOne({ where: { id } });
    if (!e) throw new NotFoundException('القيد غير موجود');
    if (e.kind !== 'payment') {
      throw new BadRequestException('لا يُحذف إلا قيدُ تحويل — وما عداه يُعكس ولا يُمحى');
    }
    await this.ledger.delete({ id });
    // eslint-disable-next-line no-console
    console.warn(`[profit] حُذف تحويلٌ ${e.partner} ${e.amount} · ${user} · ${why}`);
    return { deleted: true, balances: await this.balances() };
  }

  /**
   * المصادقة — تُجمّد الرقم وتُقفل الفترة وتحمل الرصيد المعلّق.
   *
   * ولا تُصادَق فترةٌ ناقصة المدخلات: الرقم الذي يُجمَّد يُحوَّل إلى بنك، ورقمٌ
   * مبنيٌّ على نقصٍ يُجمَّد خطأً ثمّ يُبنى عليه ما بعده.
   */
  async ratify(period: ProfitPeriod, result: Ratifiable, user: string) {
    if (period.ratified_at) {
      throw new BadRequestException('الفترة مُصادَقٌ عليها بالفعل — فُكَّ المصادقة أوّلاً');
    }
    if (result.distribution.missing.length) {
      throw new BadRequestException(
        `لا تُصادَق فترةٌ ناقصة المدخلات: ${result.distribution.missing.join(' · ')}`,
      );
    }
    if (!result.proposed.available) {
      throw new BadRequestException(
        `لا يُحسب التحويل: ${result.proposed.reason || 'الطريقة المعتمدة غير متاحة'}`,
      );
    }

    const carried = await this.balances();
    const computed = result.proposed.partnerTransfer;
    /** الرصيد بعد قيد الاستحقاق — وهو المستحقّ تحويله، لا المُحوَّل */
    const paid: Record<Partner, number> = {
      badawi: this.r2(computed.badawi + carried.badawi),
      ittihad: this.r2(computed.ittihad + carried.ittihad),
    };

    const at = new Date();

    /*
     * المصادقة تُقيّد **الاستحقاق** ولا تُصفّر شيئاً.
     *
     * فالحساب جارٍ: الرصيد بعدها = ما كان + ما استُحقّ. ويبقى مستحقّاً حتّى
     * يُقيَّد تحويلٌ فعليّ — لأنّ المستحقّ لا يُحوَّل كلّه دائماً، بقرار المالك.
     *
     * وكان هنا قيدُ `applied` يُصفّر الرصيد فيظهر صفراً أبداً، ويُحسب المُحوَّل
     * رقماً في اللقطة لا قيداً في الدفتر. فلا يُعرف كم بقي.
     */
    for (const p of PARTNERS) {
      if (Math.abs(computed[p]) <= ProfitRatificationService.TOLERANCE) continue;
      await this.ledger.save(this.ledger.create({
        period_id: period.id,
        occurred_at: at,
        partner: p,
        amount: this.r2(computed[p]),
        kind: 'due',
        note: `المستحقّ عن «${period.period_name.trim()}» — بالمصادقة`,
        created_by: user,
      }));
    }

    period.ratified_at = at;
    period.ratified_by = user;
    period.ratified_snapshot = {
      at: at.toISOString(),
      by: user,
      /** ناتج الطريقة المعتمدة للمصادقة — ومنها خرج الرقم */
      result: result.proposed,
      /** وسلسلة المستند بجوارها: حصص الأعباء وأثر الشراكة والمقارنة */
      distribution: result.distribution,
      /** المحسوب قبل حمل الرصيد */
      computedTransfer: computed,
      /** الرصيد الذي حُمل من فتراتٍ سابقة */
      carriedIn: carried,
      /** وهذا هو الرقم الذي يُحوَّل فعلاً إلى البنك */
      transferPaid: paid,
      voyageDetail: period.voyage_detail ?? null,
    };
    await this.periods.save(period);

    return { ratified: true, at, by: user, carriedIn: carried, transferPaid: paid };
  }

  /**
   * فكّ المصادقة — بسببٍ مكتوب، وبقيدٍ عكسيّ لا بحذف.
   *
   * الحذف يُخفي أنّ شيئاً جرى. والعكس يُبقي الأثر: قُيِّد، ثمّ عُكس، وهنا السبب.
   */
  async unratify(period: ProfitPeriod, reason: string, user: string) {
    if (!period.ratified_at) {
      throw new BadRequestException('الفترة غير مُصادَقٍ عليها');
    }
    const why = String(reason || '').trim();
    if (!why) {
      throw new BadRequestException('فكّ المصادقة يستوجب سبباً مكتوباً');
    }

    /*
     * فكّ المصادقة يعكس **الاستحقاق** الذي كتبته، لا التحويلات.
     *
     * فالتحويل واقعةٌ جرت: مالٌ خرج إلى بنك. وعكسُه يعني إنكارَ حوالةٍ نُفّذت.
     * والاستحقاق قيدٌ حسابيّ كتبته المصادقة — فيُعكس معها.
     */
    const at = new Date();
    const mine = await this.ledger.find({ where: { period_id: period.id } });
    const payments = mine.filter((e) => e.kind === 'payment');
    if (payments.length) {
      throw new BadRequestException(
        `على هذه الفترة ${payments.length} تحويلاً مُقيَّداً — احذفها أوّلاً إن كانت خطأً، `
        + 'فلا تُفكّ مصادقةٌ خرج بها مالٌ إلى بنك',
      );
    }
    for (const e of mine) {
      if (e.kind !== 'due' && e.kind !== 'applied') continue;
      await this.ledger.save(this.ledger.create({
        period_id: period.id,
        occurred_at: at,
        partner: e.partner,
        amount: this.r2(-Number(e.amount)),
        kind: e.kind,
        note: `عكسُ ${e.kind === 'due' ? 'استحقاق' : 'تسوية'} بفكّ مصادقة «${period.period_name.trim()}» — ${why}`,
        created_by: user,
      }));
    }

    period.ratified_at = null;
    period.ratified_by = null;
    period.ratified_snapshot = null;
    await this.periods.save(period);
    return {
      ratified: false,
      reversed: mine.filter((e) => e.kind === 'due' || e.kind === 'applied').length,
      reason: why,
    };
  }

  /**
   * تسجيل سحبٍ جديد على فترةٍ مُصادَقة، وقيدُ الفرق.
   *
   * ── لماذا قيدٌ واحدٌ مفتوح لكلّ فترةٍ وشريك ──
   * السحب يتكرّر. ولو أُضيف قيدٌ في كلّ مرّة لتضاعف الفرق نفسه مرّاتٍ عدداً.
   * فالمفتوح **يُستبدل**: الفرق القائم هو `المحسوب الآن − المُجمَّد`، لا أكثر.
   * والقيود المُسوّاة (`applied`) لا تُمسّ — فهي تاريخٌ أُقفل.
   */
  async recordLatest(
    period: ProfitPeriod,
    latest: Ratifiable,
    user: string,
    fetchedAt?: string,
  ) {
    if (!period.ratified_at || !period.ratified_snapshot) {
      throw new BadRequestException('لا تُقارَن فترةٌ لم يُصادَق عليها');
    }
    const snap = period.ratified_snapshot as {
      computedTransfer: Record<Partner, number>;
    };
    const at = new Date();

    period.latest_snapshot = {
      at: at.toISOString(), by: user, fetchedAt: fetchedAt || null,
      result: latest.proposed, distribution: latest.distribution,
    };
    period.latest_fetched_at = at;
    await this.periods.save(period);

    const deltas = {} as Record<Partner, number>;
    for (const p of PARTNERS) {
      deltas[p] = this.r2(
        (latest.proposed.partnerTransfer?.[p] || 0) - (Number(snap.computedTransfer?.[p]) || 0),
      );
    }

    // القيد المفتوح يُستبدل، والمُسوّى لا يُمسّ
    await this.ledger.delete({ period_id: period.id, kind: 'delta' });

    for (const p of PARTNERS) {
      if (Math.abs(deltas[p]) <= ProfitRatificationService.TOLERANCE) continue;
      await this.ledger.save(this.ledger.create({
        period_id: period.id,
        occurred_at: at,
        partner: p,
        amount: deltas[p],
        kind: 'delta',
        note: `فرقٌ بعد سحبٍ جديد على «${period.period_name}»`
          + (fetchedAt ? ` · آخر تحديثٍ للشيت ${fetchedAt}` : ''),
        created_by: user,
      }));
    }

    return { deltas, balances: await this.balances(), at };
  }
}
