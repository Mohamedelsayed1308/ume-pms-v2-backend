import {
  computeTripCount, computeTrucksTotal, computeDepartureTrucks, computeArrivalTrucks,
  sameMonthsPrevYear, growthOf, shareChangePoints, shipComposition, share, aggregateByAgency, productivity,
} from './market.calc';

describe('market.calc — قواعد الحساب الأساسية', () => {
  it('عدد الرحلات = MAX(مغادرة, وصول) وليس الجمع', () => {
    expect(computeTripCount({ departure_voyages: 11, arrival_voyages: 9 })).toBe(11);
    expect(computeTripCount({ departure_voyages: 4, arrival_voyages: 7 })).toBe(7);
  });

  it('إجمالي الشاحنات = مجموع التصنيفات التسعة في الاتجاهين', () => {
    const r = { dep_truck: 1128, dep_dyana: 30, dep_lory: 10, dep_mafi: 4, arr_truck: 1086, arr_dyana: 38, arr_lory: 5, arr_loped: 7, arr_equipment: 1, arr_mafi: 1 };
    expect(computeDepartureTrucks(r)).toBe(1172);
    expect(computeArrivalTrucks(r)).toBe(1138);
    expect(computeTrucksTotal(r)).toBe(2310);
  });
});

describe('sameMonthsPrevYear — إزاحة 12 شهراً', () => {
  it('يناير–يوليو 2026 → يناير–يوليو 2025', () => {
    expect(sameMonthsPrevYear(2026, 1, 2026, 7)).toEqual({ fromY: 2025, fromM: 1, toY: 2025, toM: 7 });
  });
  it('مايو–يوليو 2026 → مايو–يوليو 2025', () => {
    expect(sameMonthsPrevYear(2026, 5, 2026, 7)).toEqual({ fromY: 2025, fromM: 5, toY: 2025, toM: 7 });
  });
  it('شهر واحد: مارس 2026 → مارس 2025', () => {
    expect(sameMonthsPrevYear(2026, 3, 2026, 3)).toEqual({ fromY: 2025, fromM: 3, toY: 2025, toM: 3 });
  });
});

describe('growthOf — معادلات النمو ومعالجة الأساس الصفري', () => {
  it('نمو عادي', () => {
    const g = growthOf(514, 390);
    expect(g.status).toBe('normal');
    expect(g.abs).toBe(124);
    expect(Math.round(g.pct! * 10) / 10).toBe(31.8);
    expect(g.direction).toBe('up');
  });
  it('انكماش عادي', () => {
    const g = growthOf(80, 100);
    expect(g.abs).toBe(-20); expect(g.pct).toBeCloseTo(-20); expect(g.direction).toBe('down');
  });
  it('الأساس صفر والحالي موجب → نشاط جديد لا Infinity', () => {
    const g = growthOf(50, 0);
    expect(g.status).toBe('new_activity'); expect(g.pct).toBeNull(); expect(g.label).toBe('نشاط جديد');
  });
  it('الأساس موجب والحالي صفر → انكماش 100%', () => {
    const g = growthOf(0, 40);
    expect(g.status).toBe('contraction_full'); expect(g.pct).toBe(-100);
  });
  it('الأساس والحالي صفر → لا توجد حركة', () => {
    const g = growthOf(0, 0);
    expect(g.status).toBe('no_movement'); expect(g.pct).toBeNull(); expect(g.abs).toBe(0);
  });
});

describe('نمو السوق المرجعي يناير–يوليو (2025 → 2026)', () => {
  const ref2025 = { trips: 390, trucks: 67609, cars: 12259, passengers: 99705 };
  const cur2026 = { trips: 514, trucks: 97701, cars: 14598, passengers: 122044 };
  it('نسب النمو تطابق القيم المتوقعة تقريبياً', () => {
    expect(Math.round(growthOf(cur2026.trips, ref2025.trips).pct! * 10) / 10).toBe(31.8);
    expect(Math.round(growthOf(cur2026.trucks, ref2025.trucks).pct! * 10) / 10).toBe(44.5);
    expect(Math.round(growthOf(cur2026.cars, ref2025.cars).pct! * 10) / 10).toBe(19.1);
    expect(Math.round(growthOf(cur2026.passengers, ref2025.passengers).pct! * 10) / 10).toBe(22.4);
  });
});

describe('shareChangePoints — تغيّر الحصة بالنقاط المئوية', () => {
  it('من 35% إلى 40% = +5 نقاط (وليس 5% نمو)', () => {
    expect(shareChangePoints(0.40, 0.35)).toBeCloseTo(5);
  });
  it('فقدان حصة يعطي قيمة سالبة', () => {
    expect(shareChangePoints(0.30, 0.339)).toBeCloseTo(-3.9);
  });
});

describe('share — المقام دائماً كامل السوق', () => {
  it('الحصة = جزء ÷ إجمالي السوق حتى عند تركيز وكيل', () => {
    // بدوي 174 من 514 رحلة سوق = 33.85%
    expect(Math.round(share(174, 514) * 1000) / 10).toBe(33.9);
  });
  it('مقام صفر يعطي صفر لا NaN', () => {
    expect(share(10, 0)).toBe(0);
  });
});

describe('shipComposition — اختلاف تكوين السوق بين العامين', () => {
  const prev = [
    { ship_key: 'ALCUDIA', ship_name_ar: 'الكوديا', agency_key: 'BADAWY', trip_count: 5, trucks_total: 10, cars_total: 1, passengers_total: 2 },
    { ship_key: 'OLD_SHIP', ship_name_ar: 'قديمة', agency_key: 'X', trip_count: 3, trucks_total: 5, cars_total: 0, passengers_total: 0 },
  ];
  const now = [
    { ship_key: 'ALCUDIA', ship_name_ar: 'الكوديا', agency_key: 'BADAWY', trip_count: 8, trucks_total: 12, cars_total: 1, passengers_total: 2 },
    { ship_key: 'SINAA', ship_name_ar: 'سيناء', agency_key: 'BADAWY', trip_count: 4, trucks_total: 6, cars_total: 0, passengers_total: 1 },
  ];
  it('يصنّف المستمرة والداخلة والخارجة', () => {
    const c = shipComposition(now, prev);
    expect(c.both.map((s) => s.ship)).toContain('ALCUDIA');
    expect(c.entered.map((s) => s.ship)).toContain('SINAA');
    expect(c.exited.map((s) => s.ship)).toContain('OLD_SHIP');
  });
});

describe('aggregateByAgency + productivity', () => {
  const rows = [
    { agency_key: 'BADAWY', agency_name_ar: 'بدوي', trip_count: 10, trucks_total: 100, cars_total: 20, passengers_total: 200 },
    { agency_key: 'BADAWY', agency_name_ar: 'بدوي', trip_count: 5, trucks_total: 50, cars_total: 10, passengers_total: 100 },
  ];
  it('يجمع مؤشرات الوكيل', () => {
    const a = aggregateByAgency(rows);
    expect(a.BADAWY.trips).toBe(15); expect(a.BADAWY.trucks).toBe(150);
  });
  it('الإنتاجية لكل رحلة', () => {
    const p = productivity(rows);
    expect(p.trucksPerTrip).toBeCloseTo(150 / 15);
  });
});
