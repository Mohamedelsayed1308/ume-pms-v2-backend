import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ProfitPeriod } from './profit-period.entity';
import {
  ProfitSettlement, PARTNERS, PARTNER_NAMES, Partner,
} from './profit-settlement.entity';
import { ModelResult } from './profit-model';

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

  /** دفتر الفروق كاملاً — الأحدث أوّلاً، ومعه أسماء الفترات. */
  async statement() {
    const entries = await this.ledger.find({ order: { occurred_at: 'DESC', created_at: 'DESC' } });
    const ids = [...new Set(entries.map((e) => e.period_id))];
    const names: Record<string, string> = {};
    if (ids.length) {
      const ps = await this.periods.find({ where: ids.map((id) => ({ id })) });
      for (const p of ps) names[p.id] = p.period_name;
    }
    return {
      balances: await this.balances(),
      partnerNames: PARTNER_NAMES,
      entries: entries.map((e) => ({
        ...e,
        amount: this.r2(Number(e.amount)),
        period_name: names[e.period_id] || '—',
      })),
    };
  }

  /**
   * المصادقة — تُجمّد الرقم وتُقفل الفترة وتحمل الرصيد المعلّق.
   *
   * ولا تُصادَق فترةٌ ناقصة المدخلات: الرقم الذي يُجمَّد يُحوَّل إلى بنك، ورقمٌ
   * مبنيٌّ على نقصٍ يُجمَّد خطأً ثمّ يُبنى عليه ما بعده.
   */
  async ratify(period: ProfitPeriod, result: ModelResult, user: string) {
    if (period.ratified_at) {
      throw new BadRequestException('الفترة مُصادَقٌ عليها بالفعل — فُكَّ المصادقة أوّلاً');
    }
    if (result.missing.length) {
      throw new BadRequestException(
        `لا تُصادَق فترةٌ ناقصة المدخلات: ${result.missing.join(' · ')}`,
      );
    }

    const carried = await this.balances();
    const computed = result.partnerTransfer;
    const paid: Record<Partner, number> = {
      badawi: this.r2(computed.badawi + carried.badawi),
      ittihad: this.r2(computed.ittihad + carried.ittihad),
    };

    const at = new Date();

    /*
     * التسوية تُقفل ما كان معلّقاً بقيدٍ مقابل، ولا تُحذف القيود القديمة.
     * فالرصيد يعود صفراً ويبقى تاريخه مقروءاً.
     */
    for (const p of PARTNERS) {
      if (Math.abs(carried[p]) <= ProfitRatificationService.TOLERANCE) continue;
      await this.ledger.save(this.ledger.create({
        period_id: period.id,
        occurred_at: at,
        partner: p,
        amount: this.r2(-carried[p]),
        kind: 'applied',
        note: `أُدخل في مصادقة «${period.period_name}» — ${carried[p] > 0 ? 'زيادةً' : 'خصماً'}`,
        created_by: user,
      }));
    }

    period.ratified_at = at;
    period.ratified_by = user;
    period.ratified_snapshot = {
      at: at.toISOString(),
      by: user,
      /** ناتج المحرّك كاملاً — المدخلات مقروءةٌ منه ومن `voyage_detail` */
      result,
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

    const at = new Date();
    const mine = await this.ledger.find({ where: { period_id: period.id } });
    for (const e of mine) {
      if (e.kind !== 'applied') continue;
      await this.ledger.save(this.ledger.create({
        period_id: period.id,
        occurred_at: at,
        partner: e.partner,
        amount: this.r2(-Number(e.amount)),
        kind: 'applied',
        note: `عكسُ تسوية بفكّ مصادقة «${period.period_name}» — ${why}`,
        created_by: user,
      }));
    }

    period.ratified_at = null;
    period.ratified_by = null;
    period.ratified_snapshot = null;
    await this.periods.save(period);
    return { ratified: false, reversed: mine.filter((e) => e.kind === 'applied').length, reason: why };
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
    latest: ModelResult,
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

    period.latest_snapshot = { at: at.toISOString(), by: user, fetchedAt: fetchedAt || null, result: latest };
    period.latest_fetched_at = at;
    await this.periods.save(period);

    const deltas = {} as Record<Partner, number>;
    for (const p of PARTNERS) {
      deltas[p] = this.r2(latest.partnerTransfer[p] - (Number(snap.computedTransfer?.[p]) || 0));
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
