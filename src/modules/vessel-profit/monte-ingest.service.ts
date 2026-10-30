import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { VesselProfitData } from './vessel-profit.entity';
import { validateMontePackage } from './monte-package';

export const MONTE_KEY = 'MonteJS';
export const MONTE_SOURCE = 'monte-session';

/** ترتيبٌ ثابت للمفاتيح — jsonb في Postgres لا يحفظ ترتيبها، فالمقارنة النصّيّة وحدها تخطئ. */
function canonical(x: unknown): string {
  if (Array.isArray(x)) return `[${x.map(canonical).join(',')}]`;
  if (x && typeof x === 'object') {
    return `{${Object.keys(x as object).sort().map((k) => `${JSON.stringify(k)}:${canonical((x as any)[k])}`).join(',')}}`;
  }
  return JSON.stringify(x) ?? 'null';
}

const ISO = /^\d{4}-\d\d-\d\dT\d\d:\d\d/;

/**
 * الدفع الآليّ لحزمة مونتي من جلستها (بقرار المالك ٣٠ أكتوبر ٢٠٢٦).
 *
 * يكتب ما يكتبه زرّ الرفع في الكارت: `manual.package` للمفتاح `MonteJS` مع اسم الملفّ ووقت
 * الحفظ، ويُبقي بقيّة مفاتيح `manual` كما هي. ويزيد `packageSource` ليُعرف في الكارت أنّها
 * وصلت آليّاً. بلا هجرة — الحقل jsonb قائم.
 *
 * - حزمةٌ لا تطابق نفسها تُرفض (400) بالرسائل نفسها التي يعرضها الكارت.
 * - حزمةٌ أقدم من المحفوظة تُرفض (409): تشغيلٌ متأخّر لا يمحو أحدث منه. والرجوع
 *   المقصود إلى حزمةٍ قديمة يبقى بزرّ الرفع في الكارت.
 * - الحزمة نفسها لا تُعاد كتابتها، فتكرار التشغيل لا يغيّر وقت الحفظ.
 */
@Injectable()
export class MonteIngestService {
  constructor(@InjectRepository(VesselProfitData) private repo: Repository<VesselProfitData>) {}

  async ingest(raw: unknown, file?: unknown) {
    const check = validateMontePackage(raw);
    if (!check.ok) throw new BadRequestException({ message: 'الحزمة مرفوضة — لا تطابق نفسها', errors: check.errors });

    const row = (await this.repo.findOne({ where: { vessel: MONTE_KEY } })) || this.repo.create({ vessel: MONTE_KEY });
    const manual = row.manual && typeof row.manual === 'object' && !Array.isArray(row.manual) ? row.manual : {};
    const summary = { voyages: check.voyages, hidden: check.hidden, warnings: check.warnings, generatedAt: check.generatedAt };

    const prevAt = manual.package?.generated_at;
    if (typeof prevAt === 'string' && ISO.test(prevAt) && check.generatedAt && ISO.test(check.generatedAt) && check.generatedAt < prevAt) {
      throw new ConflictException(`المحفوظة أحدث (${prevAt}) من المدفوعة (${check.generatedAt}) — للرجوع إليها ارفعها من الكارت`);
    }
    if (manual.package && canonical(manual.package) === canonical(raw)) {
      return { saved: false, unchanged: true, ...summary, savedAt: manual.packageSavedAt ?? null };
    }

    const name = typeof file === 'string' ? file.split(/[\\/]/).pop()!.slice(0, 120) : '';
    const savedAt = new Date().toISOString();
    row.manual = { ...manual, package: raw, packageFile: name || 'monte_pms.json', packageSavedAt: savedAt, packageSource: MONTE_SOURCE };
    await this.repo.save(row);
    return { saved: true, unchanged: false, ...summary, savedAt };
  }
}
