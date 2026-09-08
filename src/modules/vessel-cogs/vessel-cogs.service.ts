import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { VesselCogsEntry } from './vessel-cogs.entity';
import { classify, dedupeKey, rowError, type CogsRow } from './vessel-cogs-classify';

/**
 * ── الاستيراد: خطّةٌ تُعرض ثمّ كتابةٌ لما هو جديد وحده ──
 *
 * الملفّ يتكرّر شهريّاً بكامل السنة. فالخطّة تفصل: جديدٌ يُكتب، وموجودٌ يُتخطّى،
 * و**موجودٌ في القاعدة وغائبٌ عن الملفّ** — وهذا الأخير يُعرض ولا يُحذف: قيدٌ
 * صُحّح في QuickBooks يبدو غائباً، والحذف بيد المالك من الشاشة قيداً قيداً.
 */
export interface PlanRow extends CogsRow {
  account_code: string; category: string; item_label: string; depreciation_months: number | null;
  charged: boolean; exclude_reason: string; unmapped: boolean; dedupe_key: string; status: 'new' | 'existing' | 'skipped' | 'error'; error?: string;
}

export interface ImportPlan {
  vessel: string;
  batch_code: string;
  counts: { total: number; new: number; existing: number; skipped: number; errors: number; unmapped: number };
  /** آخر تاريخٍ يُقبل من الملفّ — ما بعده يُدخَل من شاشة النظام */
  until: string | null;
  totals_new_usd: number;
  by_category: { category: string; item_label: string; charged: boolean; count: number; usd: number }[];
  rows: PlanRow[];
  vanished: { id: string; entry_date: string; doc_number: string; supplier: string; amount_usd: string; account_code: string }[];
}

const MAX_ROWS = 5000;

@Injectable()
export class VesselCogsService {
  constructor(@InjectRepository(VesselCogsEntry) private repo: Repository<VesselCogsEntry>) {}

  listByVessel(vessel: string) {
    return this.repo.find({ where: { vessel }, order: { entry_date: 'ASC', created_at: 'ASC' } });
  }

  async plan(vessel: string, rows: CogsRow[], batchCode: string, until: string | null = null): Promise<ImportPlan> {
    if (!vessel || typeof vessel !== 'string') throw new BadRequestException('اسم السفينة مطلوب');
    if (!Array.isArray(rows) || rows.length === 0) throw new BadRequestException('لا صفوف');
    if (rows.length > MAX_ROWS) throw new BadRequestException(`الحدّ ${MAX_ROWS} صفّاً في الملفّ الواحد`);
    if (until && !/^\d{4}-\d{2}-\d{2}$/.test(until)) throw new BadRequestException('حدّ الاستيراد بصيغة YYYY-MM-DD');

    const planned: PlanRow[] = rows.map((r) => {
      const err = rowError(r);
      const c = classify(r);
      const key = err ? '' : dedupeKey(vessel, r, c.account_code);
      /*
       * ما بعد الحدّ لا يُستورد: بقرار المالك، QuickBooks حتّى يوليو ٢٠٢٦ وما بعده من
       * شاشة النظام. يُعرض «مُتخطّى» ولا يُكتب ولا يُعدّ خطأً.
       */
      const late = !err && until != null && r.entry_date > until;
      return { ...r, ...c, dedupe_key: key, status: err ? 'error' : late ? 'skipped' : 'new', error: err || (late ? `بعد حدّ الاستيراد ${until}` : undefined) };
    });

    const keys = planned.filter((p) => p.dedupe_key).map((p) => p.dedupe_key);
    const existing = keys.length
      ? await this.repo.find({ where: { dedupe_key: In(keys) }, select: { dedupe_key: true } })
      : [];
    const have = new Set(existing.map((e) => e.dedupe_key));
    for (const p of planned) if (p.status === 'new' && have.has(p.dedupe_key)) p.status = 'existing';

    // الموجود في القاعدة من المصدر نفسه وليس في الملفّ
    const inDb = await this.repo.find({ where: { vessel, source: 'quickbooks' } });
    const fileKeys = new Set(keys);
    const vanished = inDb.filter((e) => !fileKeys.has(e.dedupe_key) && (until == null || e.entry_date <= until))
      .map((e) => ({ id: e.id, entry_date: e.entry_date, doc_number: e.doc_number, supplier: e.supplier, amount_usd: e.amount_usd, account_code: e.account_code }));

    const cat = new Map<string, { category: string; item_label: string; charged: boolean; count: number; usd: number }>();
    for (const p of planned) {
      if (p.status !== 'new') continue;
      const k = `${p.category}|${p.charged}`;
      const cur = cat.get(k) || { category: p.category, item_label: p.item_label, charged: p.charged, count: 0, usd: 0 };
      cur.count += 1; cur.usd = r2(cur.usd + Number(p.amount_usd)); cat.set(k, cur);
    }
    const newRows = planned.filter((p) => p.status === 'new');
    return {
      vessel, batch_code: batchCode, until,
      counts: {
        total: planned.length, new: newRows.length,
        existing: planned.filter((p) => p.status === 'existing').length,
        skipped: planned.filter((p) => p.status === 'skipped').length,
        errors: planned.filter((p) => p.status === 'error').length,
        unmapped: planned.filter((p) => p.unmapped).length,
      },
      totals_new_usd: r2(newRows.reduce((a, p) => a + Number(p.amount_usd), 0)),
      by_category: [...cat.values()].sort((a, b) => b.usd - a.usd),
      rows: planned,
      vanished,
    };
  }

  /** يكتب الجديد وحده. ويرفض الخطّة التي فيها أخطاء صفوفٍ حتّى تُصحَّح. */
  async commit(vessel: string, rows: CogsRow[], batchCode: string, user = '', until: string | null = null) {
    const plan = await this.plan(vessel, rows, batchCode, until);
    if (plan.counts.errors > 0) throw new BadRequestException(`${plan.counts.errors} صفّاً به خطأ — صحّحه قبل الترحيل`);
    const code = String(batchCode || '').trim().slice(0, 60) || `COGS-${new Date().toISOString().slice(0, 10)}`;
    const toWrite = plan.rows.filter((p) => p.status === 'new').map((p) => this.repo.create({
      vessel, source: 'quickbooks', dedupe_key: p.dedupe_key, batch_code: code,
      account_code: p.account_code, account_path: String(p.account_path).slice(0, 200), doc_type: String(p.doc_type || '').slice(0, 30),
      entry_date: p.entry_date, doc_number: String(p.doc_number || '').slice(0, 100), supplier: String(p.supplier || '').slice(0, 200),
      memo: String(p.memo || ''), amount_usd: Number(p.amount_usd).toFixed(2),
      amount_book: p.amount_book == null ? null : Number(p.amount_book).toFixed(2), book_currency: 'EUR',
      category: p.category, item_label: p.item_label, depreciation_months: p.depreciation_months,
      charged: p.charged, exclude_reason: p.exclude_reason, note: p.unmapped ? 'حسابٌ خارج الخريطة — راجع التصنيف' : '',
      created_by: user,
    }));
    await this.repo.manager.transaction(async (em) => { if (toWrite.length) await em.save(VesselCogsEntry, toWrite, { chunk: 200 }); });
    return { written: toWrite.length, skipped_existing: plan.counts.existing, skipped_after_until: plan.counts.skipped, batch_code: code, totals_written_usd: plan.totals_new_usd };
  }

  /**
   * سطرٌ يدويّ — وثيقة تأمينٍ أو إهلاكٌ سنويّ. المبلغ الكلّيّ وشهور التقسيط،
   * والكارت يقسّمه بالتساوي من شهر التاريخ.
   */
  async addManual(b: any, user = '') {
    const vessel = String(b?.vessel || '').trim();
    const date = String(b?.entry_date || '');
    const usd = Number(b?.amount_usd);
    const months = b?.depreciation_months == null || b.depreciation_months === '' ? null : Number(b.depreciation_months);
    if (!vessel) throw new BadRequestException('اسم السفينة مطلوب');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new BadRequestException('التاريخ بصيغة YYYY-MM-DD');
    if (!Number.isFinite(usd) || usd === 0) throw new BadRequestException('المبلغ مطلوب');
    if (months != null && (!Number.isInteger(months) || months < 1 || months > 120)) throw new BadRequestException('شهور التقسيط بين 1 و120');
    const category = String(b?.category || 'other').slice(0, 40);
    const label = String(b?.item_label || '').trim().slice(0, 120);
    if (!label) throw new BadRequestException('اسم البند مطلوب');
    const source: 'policy' | 'manual' = b?.source === 'policy' ? 'policy' : 'manual';
    const key = dedupeKey(vessel, {
      account_path: `manual/${category}`, doc_type: source, entry_date: date, doc_number: String(b?.doc_number || ''),
      supplier: String(b?.supplier || ''), memo: '', amount_book: null, amount_usd: usd,
    }, category);
    if (await this.repo.findOne({ where: { dedupe_key: key } })) throw new BadRequestException('سطرٌ مطابقٌ موجود');
    return this.repo.save(this.repo.create({
      vessel, source, dedupe_key: key, batch_code: '', account_code: '', account_path: `manual/${category}`, doc_type: source,
      entry_date: date, doc_number: String(b?.doc_number || '').slice(0, 100), supplier: String(b?.supplier || '').slice(0, 200),
      memo: String(b?.memo || ''), amount_usd: usd.toFixed(2), amount_book: null, book_currency: 'USD',
      category, item_label: label, depreciation_months: months, charged: true, exclude_reason: '', note: String(b?.note || ''), created_by: user,
    }));
  }

  /**
   * إعادة تطبيق خريطة التصنيف على ما استُورد من QuickBooks.
   *
   * القواعد تتغيّر بقرار المالك (مصاريف التوكيلين عادت إلى الدفتر في المساء
   * نفسه)، والقيود المستورَدة قبل التغيير تحمل القرار القديم. فتُعاد قراءتها من
   * مسار حسابها، ويُحدَّث التصنيف والتحميل والسبب — **ولا يُمسّ الإهلاك**: عموده
   * نصّيٌّ في الملفّ لا يُحفظ، وما حُوِّل عند الاستيراد يبقى.
   */
  async reapplyRules(vessel: string) {
    const rows = await this.repo.find({ where: { vessel, source: 'quickbooks' } });
    let changed = 0;
    for (const r of rows) {
      const c = classify({ account_path: r.account_path, doc_type: r.doc_type, entry_date: r.entry_date, doc_number: r.doc_number, supplier: r.supplier, memo: r.memo, amount_book: null, amount_usd: Number(r.amount_usd) });
      if (c.unmapped) continue;
      if (r.category === c.category && r.item_label === c.item_label && r.charged === c.charged && r.exclude_reason === c.exclude_reason) continue;
      r.category = c.category; r.item_label = c.item_label; r.charged = c.charged; r.exclude_reason = c.exclude_reason;
      if (!c.charged) r.depreciation_months = null;
      changed += 1;
    }
    if (changed) await this.repo.save(rows, { chunk: 200 });
    return { scanned: rows.length, changed };
  }

  async remove(id: string) {
    const row = await this.repo.findOne({ where: { id } });
    if (!row) throw new NotFoundException('غير موجود');
    await this.repo.remove(row);
    return { removed: id };
  }
}

const r2 = (v: number) => Math.round(v * 100) / 100;
