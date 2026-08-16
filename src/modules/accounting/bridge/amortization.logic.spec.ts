import { spreadAmount, monthShare, planMonth, amortizationMonthsDue, type PrepaidSchedule } from './amortization.logic';
import { monthsBetween } from './depreciation.logic';

const NS = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';

const sched = (o: Partial<PrepaidSchedule> = {}): PrepaidSchedule => ({
  id: 's1', description: 'عقد', source_reference: 'INV-1',
  total_amount: 1200, start_month: '2026-07', end_month: '2027-06',
  expense_account_id: 'exp-5040', prepaid_account_id: 'pre-1220',
  vessel_id: 'gubal', customer_id: null, ...o,
});

describe('spreadAmount', () => {
  it('يوزّع بالتساوي حين تقبل القسمة', () => {
    const r = spreadAmount(1200, ['2026-07', '2026-08', '2026-09']);
    expect(r.map((x) => x.amount)).toEqual([400, 400, 400]);
  });

  it('الشهر الأخير يحمل الباقي فيطابق المجموع الأصل بالسنت', () => {
    const r = spreadAmount(100, ['2026-01', '2026-02', '2026-03']);
    expect(r.map((x) => x.amount)).toEqual([33.33, 33.33, 33.34]);
    expect(r.reduce((s, x) => s + x.amount, 0)).toBeCloseTo(100, 2);
  });

  it('مبلغ حقيقي على ثلاثة وعشرين شهراً لا يترك رصيداً شبحاً', () => {
    // Turbo Systems 2946 (D358) — من يوليو 2026 إلى مايو 2028
    const months = monthsBetween('2026-07', '2028-05');
    expect(months).toHaveLength(23);
    const r = spreadAmount(33962.81, months);
    const sum = Math.round(r.reduce((s, x) => s + x.amount, 0) * 100) / 100;
    expect(sum).toBe(33962.81);
  });

  it('والمبلغ الكامل للقيد كذلك لا يترك كسراً', () => {
    const r = spreadAmount(634285.67, monthsBetween('2026-07', '2029-02'));
    const sum = Math.round(r.reduce((s, x) => s + x.amount, 0) * 100) / 100;
    expect(sum).toBe(634285.67);
  });

  it('آخر يوم في الشهر بحساب تقويمي — فبراير لا يُخطئ', () => {
    expect(spreadAmount(100, ['2028-02'])[0].accounting_date).toBe('2028-02-29');
  });

  it('لا يقبل مبلغاً غير موجب', () => {
    expect(() => spreadAmount(0, ['2026-07'])).toThrow();
  });
});

describe('monthShare', () => {
  it('يعطي حصّة الشهر داخل المدّة', () => {
    expect(monthShare(sched(), '2026-08')!.amount).toBe(100);
  });

  it('لا شيء قبل البداية ولا بعد النهاية', () => {
    expect(monthShare(sched(), '2026-06')).toBeNull();
    expect(monthShare(sched(), '2027-07')).toBeNull();
  });

  it('الشهر الأخير يحمل الباقي لا القسط', () => {
    const s = sched({ total_amount: 100, start_month: '2026-07', end_month: '2026-09' });
    expect(monthShare(s, '2026-07')!.amount).toBe(33.33);
    expect(monthShare(s, '2026-09')!.amount).toBe(33.34);
  });
});

describe('planMonth', () => {
  it('يجمع الجداول ذات الحساب الواحد في سطر ويترك لكل حساب سطره', () => {
    const r = planMonth({ entityId: 'e', month: '2026-08', namespace: NS, schedules: [
      sched({ id: 'a', total_amount: 1200, expense_account_id: 'exp-5040' }),
      sched({ id: 'b', total_amount: 2400, expense_account_id: 'exp-5040' }),
      sched({ id: 'c', total_amount: 1200, expense_account_id: 'exp-6030' }),
    ] })!;
    expect(r.debits).toHaveLength(2);
    expect(r.debits.find((d) => d.expense_account_id === 'exp-5040')!.amount).toBe(300);
    expect(r.total).toBe(400);
    expect(r.credit.amount).toBe(400);
  });

  it('المدين يساوي الدائن دائماً', () => {
    const r = planMonth({ entityId: 'e', month: '2026-08', namespace: NS, schedules: [
      sched({ id: 'a', total_amount: 100, start_month: '2026-07', end_month: '2026-09' }),
      sched({ id: 'b', total_amount: 777.77, start_month: '2026-01', end_month: '2026-12', expense_account_id: 'x' }),
    ] })!;
    expect(r.total).toBe(r.credit.amount);
    expect(r.total).toBe(Math.round(r.debits.reduce((s, d) => s + d.amount, 0) * 100) / 100);
  });

  it('شهرٌ لا جدول فيه لا يُنتج قيداً', () => {
    expect(planMonth({ entityId: 'e', month: '2030-01', namespace: NS, schedules: [sched()] })).toBeNull();
  });

  it('المعرّف حتمي — التوليد مرّتين يعطي المعرّف نفسه', () => {
    const a = planMonth({ entityId: 'e', month: '2026-08', namespace: NS, schedules: [sched()] })!;
    const b = planMonth({ entityId: 'e', month: '2026-08', namespace: NS, schedules: [sched()] })!;
    expect(a.source_id).toBe(b.source_id);
  });

  it('وشهران مختلفان معرّفاهما مختلفان', () => {
    const a = planMonth({ entityId: 'e', month: '2026-08', namespace: NS, schedules: [sched()] })!;
    const b = planMonth({ entityId: 'e', month: '2026-09', namespace: NS, schedules: [sched()] })!;
    expect(a.source_id).not.toBe(b.source_id);
  });

  it('حسابا مقدَّم مختلفان في شهرٍ واحد يُرفضان — القيد لا يحتملهما', () => {
    expect(() => planMonth({ entityId: 'e', month: '2026-08', namespace: NS, schedules: [
      sched({ id: 'a' }), sched({ id: 'b', prepaid_account_id: 'other' }),
    ] })).toThrow();
  });
});

describe('amortizationMonthsDue', () => {
  it('يلحق ما مضى ولا يمسّ الشهر الجاري', () => {
    const r = amortizationMonthsDue({ schedules: [sched()], today: '2026-08-16', alreadyPosted: [] });
    expect(r).toEqual(['2026-07']);
  });

  it('يتخطّى ما رُحِّل ولا يُعيده', () => {
    const r = amortizationMonthsDue({ schedules: [sched()], today: '2026-10-05', alreadyPosted: ['2026-07', '2026-08'] });
    expect(r).toEqual(['2026-09']);
  });

  it('لا يتجاوز نهاية الجداول مهما تأخّر التشغيل', () => {
    const s = sched({ start_month: '2026-07', end_month: '2026-09' });
    const r = amortizationMonthsDue({ schedules: [s], today: '2027-06-01', alreadyPosted: [] });
    expect(r).toEqual(['2026-07', '2026-08', '2026-09']);
  });

  it('بلا جداول لا شيء مستحقّ', () => {
    expect(amortizationMonthsDue({ schedules: [], today: '2026-08-16', alreadyPosted: [] })).toEqual([]);
  });
});
