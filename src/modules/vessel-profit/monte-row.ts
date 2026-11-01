import { Repository } from 'typeorm';
import { VesselProfitData } from './vessel-profit.entity';

/**
 * تعديل صفّ مركبٍ تحت قفل — ثلاثة كُتّاب على `manual` للصفّ نفسه: الدفع الآليّ وزرّ الحفظ
 * في الكارت ومدخلات الفريق. بلا قفل يقرأ أحدهم ثمّ يكتب فوق ما أضافه آخر بينهما.
 *
 * في الإنتاج: معاملةٌ بقفل `FOR UPDATE` على الصفّ. وفي الاختبارات (مستودعٌ في الذاكرة بلا
 * `manager`) يُعدَّل مباشرةً — التنفيذ هناك متتابع أصلاً.
 */
export async function withVesselRow<T>(
  repo: Repository<VesselProfitData>,
  vessel: string,
  fn: (row: VesselProfitData, r: Repository<VesselProfitData>) => Promise<T>,
): Promise<T> {
  const tx = (repo as any).manager?.transaction;
  if (typeof tx !== 'function') {
    const row = (await repo.findOne({ where: { vessel } })) || repo.create({ vessel });
    return fn(row, repo);
  }
  return repo.manager.transaction(async (m) => {
    const r = m.getRepository(VesselProfitData);
    const row = (await r.findOne({ where: { vessel }, lock: { mode: 'pessimistic_write' } })) || r.create({ vessel });
    return fn(row, r);
  });
}
