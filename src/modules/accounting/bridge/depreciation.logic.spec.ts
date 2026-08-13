import { deterministicUuid, lastDayOfMonth, monthsBetween, planDepreciation, assertWithinCarryingAmount } from './depreciation.logic';

const NS = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';
const V = 'b47456d5-6bf2-4930-a381-fbd6cbbf4335';

describe('الإهلاك — المعرّف الحتمي', () => {
  it('1. نفس المدخلات تعطي نفس المعرّف دائماً', () => {
    const a = deterministicUuid(NS, 'depreciation:v1:2026-01');
    expect(deterministicUuid(NS, 'depreciation:v1:2026-01')).toBe(a);
  });
  it('2. شهر مختلف أو مركب مختلف يعطي معرّفاً مختلفاً', () => {
    const jan = deterministicUuid(NS, 'depreciation:v1:2026-01');
    expect(deterministicUuid(NS, 'depreciation:v1:2026-02')).not.toBe(jan);
    expect(deterministicUuid(NS, 'depreciation:v2:2026-01')).not.toBe(jan);
  });
  it('3. الصيغة UUID صالحة بالنسخة الخامسة', () => {
    const u = deterministicUuid(NS, 'x');
    expect(u).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

describe('الإهلاك — التقويم', () => {
  it('4. آخر يوم في الشهر — ومنه فبراير الكبيس', () => {
    expect(lastDayOfMonth('2026-01')).toBe('2026-01-31');
    expect(lastDayOfMonth('2026-02')).toBe('2026-02-28');
    expect(lastDayOfMonth('2024-02')).toBe('2024-02-29');
    expect(lastDayOfMonth('2026-04')).toBe('2026-04-30');
    expect(lastDayOfMonth('2026-12')).toBe('2026-12-31');
  });
  it('5. شهر بصيغة خاطئة مرفوض', () => {
    for (const m of ['2026-13', '2026-00', '2026', '26-01']) {
      expect(() => lastDayOfMonth(m)).toThrow();
    }
  });
  it('6. الأشهر بين تاريخين شاملةً طرفيها', () => {
    expect(monthsBetween('2026-01', '2026-07')).toHaveLength(7);
    expect(monthsBetween('2026-01', '2026-01')).toEqual(['2026-01']);
    expect(monthsBetween('2025-11', '2026-02')).toEqual(['2025-11', '2025-12', '2026-01', '2026-02']);
  });
  it('7. مدى معكوس مرفوض', () => {
    expect(() => monthsBetween('2026-07', '2026-01')).toThrow(/بعد نهايته/);
  });
});

describe('الإهلاك — الخطة', () => {
  it('8. سبعة أشهر بقسط Gubal الفعلي', () => {
    const p = planDepreciation({ vesselId: V, from: '2026-01', to: '2026-07', monthlyAmount: 13778.72, namespace: NS });
    expect(p).toHaveLength(7);
    expect(p[0].accounting_date).toBe('2026-01-31');
    expect(p[6].accounting_date).toBe('2026-07-31');
    expect(p[0].source_reference).toBe('DEP-2026-01');
    expect(p.reduce((a, x) => a + x.amount, 0)).toBeCloseTo(96451.04, 2);
    // كل شهر بمعرّف فريد — فلا يحجب أحدهما الآخر
    expect(new Set(p.map((x) => x.source_id)).size).toBe(7);
  });
  it('9. إعادة التخطيط تعطي نفس المعرّفات — فيمنعها فهرس التكرار', () => {
    const args = { vesselId: V, from: '2026-01', to: '2026-03', monthlyAmount: 100, namespace: NS };
    expect(planDepreciation(args).map((x) => x.source_id)).toEqual(planDepreciation(args).map((x) => x.source_id));
  });
  it('10. قسط غير موجب مرفوض', () => {
    for (const monthlyAmount of [0, -1]) {
      expect(() => planDepreciation({ vesselId: V, from: '2026-01', to: '2026-01', monthlyAmount, namespace: NS })).toThrow(/موجباً/);
    }
  });
});

describe('الإهلاك — حدّ الصافي الدفتري', () => {
  it('11. ضمن المتبقّي مقبول — حالة Gubal', () => {
    expect(() => assertWithinCarryingAmount({ costEur: 1653446, accumulatedEur: 661378.56, chargeEur: 96451.04 })).not.toThrow();
  });
  it('12. تجاوز الصافي الدفتري مرفوض', () => {
    expect(() => assertWithinCarryingAmount({ costEur: 1653446, accumulatedEur: 661378.56, chargeEur: 992067.45 }))
      .toThrow(/يتجاوز الصافي الدفتري/);
  });
  it('13. الإهلاك حتى آخر قرش مقبول', () => {
    expect(() => assertWithinCarryingAmount({ costEur: 1653446, accumulatedEur: 661378.56, chargeEur: 992067.44 })).not.toThrow();
  });
  it('14. أصل مُهلَك بالكامل لا يقبل زيادة', () => {
    expect(() => assertWithinCarryingAmount({ costEur: 1000, accumulatedEur: 1000, chargeEur: 0.01 }))
      .toThrow(/مُهلَك بالكامل/);
  });
});
