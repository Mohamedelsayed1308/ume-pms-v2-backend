// حسابات تحليل السوق — دوال نقية قابلة للاختبار. الخادم يحسب كل شيء (النموذج لا يحسب).

export const TRUCK_CATS = ['truck', 'dyana', 'lory', 'loped', 'loader', 'equipment', 'head_track', 'mafi', 'mafi_empty'] as const;
export type MetricKey = 'trips' | 'trucks' | 'cars' | 'passengers';
export const METRIC_KEYS: MetricKey[] = ['trips', 'trucks', 'cars', 'passengers'];

const n = (v: any) => Number(v || 0);

// قاعدة الملف: عدد الرحلات = MAX(المغادرة, الوصول) — لا تُجمع المغادرة والوصول.
export function computeTripCount(r: any): number {
  return Math.max(n(r.departure_voyages), n(r.arrival_voyages));
}

// مجموع تصنيفات الشاحنات التسعة في الاتجاهين.
export function computeTrucksTotal(r: any): number {
  let t = 0;
  for (const c of TRUCK_CATS) t += n(r[`dep_${c}`]) + n(r[`arr_${c}`]);
  return t;
}
export function computeDepartureTrucks(r: any): number {
  return TRUCK_CATS.reduce((s, c) => s + n(r[`dep_${c}`]), 0);
}
export function computeArrivalTrucks(r: any): number {
  return TRUCK_CATS.reduce((s, c) => s + n(r[`arr_${c}`]), 0);
}

// استخراج قيمة مؤشر من سجل.
export function metricOf(r: any, k: MetricKey): number {
  switch (k) {
    case 'trips': return n(r.trip_count);
    case 'trucks': return n(r.trucks_total);
    case 'cars': return n(r.cars_total);
    case 'passengers': return n(r.passengers_total);
  }
}

// فهرس شهري خطّي للترتيب/حساب الفترات.
export const ymIndex = (year: number, month: number) => year * 12 + (month - 1);

// قائمة الأشهر ضمن مدى [from, to] شامل.
export function monthsInRange(fromY: number, fromM: number, toY: number, toM: number): { year: number; month: number }[] {
  const out: { year: number; month: number }[] = [];
  let a = ymIndex(fromY, fromM); const b = ymIndex(toY, toM);
  for (; a <= b; a++) out.push({ year: Math.floor(a / 12), month: (a % 12) + 1 });
  return out;
}

// الفترة السابقة المكافئة (نفس عدد الأشهر، مباشرة قبل from). قد تكون null إن لم تكفِ البيانات.
export function previousPeriod(fromY: number, fromM: number, toY: number, toM: number): { fromY: number; fromM: number; toY: number; toM: number; len: number } {
  const len = ymIndex(toY, toM) - ymIndex(fromY, fromM) + 1;
  const prevToIdx = ymIndex(fromY, fromM) - 1;
  const prevFromIdx = prevToIdx - (len - 1);
  return {
    fromY: Math.floor(prevFromIdx / 12), fromM: (prevFromIdx % 12) + 1,
    toY: Math.floor(prevToIdx / 12), toM: (prevToIdx % 12) + 1, len,
  };
}

// الأشهر التي بها حركة سوق فعلية فقط (أي مؤشر > 0). تُبقى سجلات "صفر حركة" داخل الشهر الفعلي.
export function activeMonths(rows: any[]): Set<number> {
  const byMonth: Record<number, number> = {};
  for (const r of rows) {
    const idx = ymIndex(r.year, r.month_number);
    byMonth[idx] = (byMonth[idx] || 0) + metricOf(r, 'trips') + metricOf(r, 'trucks') + metricOf(r, 'cars') + metricOf(r, 'passengers');
  }
  return new Set(Object.entries(byMonth).filter(([, v]) => v > 0).map(([k]) => Number(k)));
}

// مجموع مؤشر عبر مجموعة سجلات.
export function sumMetric(rows: any[], k: MetricKey): number {
  return rows.reduce((s, r) => s + metricOf(r, k), 0);
}

// الحصة السوقية: مقامها دائماً إجمالي السوق (كل السجلات) لنفس الفترة/الشهر — حتى عند فلترة وكلاء.
export function share(part: number, marketTotal: number): number {
  return marketTotal > 0 ? part / marketTotal : 0;
}

// تجميع لكل وكيل (المفتاح المُحلّ) عبر المؤشرات الأربعة.
export function aggregateByAgency(rows: any[]): Record<string, Record<MetricKey, number> & { name?: string }> {
  const out: Record<string, any> = {};
  for (const r of rows) {
    const a = r.agency_key || '—';
    if (!out[a]) { out[a] = { trips: 0, trucks: 0, cars: 0, passengers: 0, name: r.agency_name_ar || a }; }
    for (const k of METRIC_KEYS) out[a][k] += metricOf(r, k);
  }
  return out;
}

// إنتاجية لكل رحلة.
export function productivity(rows: any[]): { trucksPerTrip: number; carsPerTrip: number; passengersPerTrip: number } {
  const trips = sumMetric(rows, 'trips');
  return {
    trucksPerTrip: trips ? sumMetric(rows, 'trucks') / trips : 0,
    carsPerTrip: trips ? sumMetric(rows, 'cars') / trips : 0,
    passengersPerTrip: trips ? sumMetric(rows, 'passengers') / trips : 0,
  };
}

// ── المقارنة السنوية (Year-over-Year) ──

// الفترة نفسها من العام السابق بإزاحة 12 شهراً إلى الخلف (يناير–يوليو 2026 → يناير–يوليو 2025).
export function sameMonthsPrevYear(fromY: number, fromM: number, toY: number, toM: number): { fromY: number; fromM: number; toY: number; toM: number } {
  const pf = ymIndex(fromY, fromM) - 12;
  const pt = ymIndex(toY, toM) - 12;
  return { fromY: Math.floor(pf / 12), fromM: (pf % 12) + 1, toY: Math.floor(pt / 12), toM: (pt % 12) + 1 };
}

export type GrowthStatus = 'normal' | 'new_activity' | 'contraction_full' | 'no_movement';
export interface Growth { current: number; previous: number; abs: number; pct: number | null; status: GrowthStatus; direction: 'up' | 'down' | 'flat'; label: string; }

// معادلة النمو/الانكماش مع معالجة الأساس الصفري (لا Infinity، لا اختلاق).
export function growthOf(current: any, previous: any): Growth {
  const cur = n(current), prev = n(previous);
  const abs = cur - prev;
  if (prev === 0 && cur === 0) return { current: cur, previous: prev, abs: 0, pct: null, status: 'no_movement', direction: 'flat', label: 'لا توجد حركة' };
  if (prev === 0 && cur > 0) return { current: cur, previous: prev, abs, pct: null, status: 'new_activity', direction: 'up', label: 'نشاط جديد' };
  if (prev > 0 && cur === 0) return { current: cur, previous: prev, abs, pct: -100, status: 'contraction_full', direction: 'down', label: 'انكماش 100%' };
  const pct = ((cur - prev) / prev) * 100;
  return { current: cur, previous: prev, abs, pct, status: 'normal', direction: abs > 0 ? 'up' : abs < 0 ? 'down' : 'flat', label: `${abs > 0 ? '+' : ''}${Math.round(pct * 10) / 10}%` };
}

// تغيّر الحصة بالنقاط المئوية (لا كنسبة نمو): من 35% إلى 40% = +5 نقاط.
export function shareChangePoints(currentShare: number, previousShare: number): number {
  return (n(currentShare) - n(previousShare)) * 100;
}

// شلال مصادر النمو: من إجمالي الفترة المرجعية → مساهمة كل وكيل (+/−) → إجمالي الفترة الحالية.
// ثابتة رياضية: مجموع مساهمات الوكلاء = صافي تغيّر السوق (لأن السوق = مجموع الوكلاء).
export function growthWaterfall(
  now: Record<string, any>, prev: Record<string, any>, k: MetricKey, focus?: string,
): { start: number; end: number; netChange: number; balanced: boolean; steps: { key: string; name: string; from: number; to: number; delta: number; isFocus: boolean }[] } {
  const keys = [...new Set([...Object.keys(now), ...Object.keys(prev)])];
  const steps = keys.map((key) => {
    const to = n(now[key]?.[k]), from = n(prev[key]?.[k]);
    return { key, name: now[key]?.name || prev[key]?.name || key, from, to, delta: to - from, isFocus: key === focus };
  }).filter((s) => s.from > 0 || s.to > 0).sort((a, b) => b.delta - a.delta);

  const start = keys.reduce((s, key) => s + n(prev[key]?.[k]), 0);
  const end = keys.reduce((s, key) => s + n(now[key]?.[k]), 0);
  const netChange = end - start;
  const stepsSum = steps.reduce((s, x) => s + x.delta, 0);
  return { start, end, netChange, balanced: Math.abs(stepsSum - netChange) < 0.0001, steps };
}

// تصنيف موضع الوكيل في مصفوفة النمو والحصة (حصة أعلى/أقل من المتوسط × نمو أسرع/أبطأ من السوق).
export type QuadrantKey = 'leader' | 'riser' | 'laggard' | 'marginal';
export function classifyQuadrant(sharePct: number, growthPct: number | null, avgSharePct: number, marketGrowthPct: number | null): QuadrantKey {
  const bigShare = n(sharePct) >= n(avgSharePct);
  // بلا أساس للمقارنة (نشاط جديد) يُعامل كنمو أسرع من السوق
  const fast = growthPct == null ? true : marketGrowthPct == null ? n(growthPct) > 0 : n(growthPct) >= n(marketGrowthPct);
  if (bigShare && fast) return 'leader';
  if (!bigShare && fast) return 'riser';
  if (bigShare && !fast) return 'laggard';
  return 'marginal';
}

// تصنيف تكوين السوق: سفن مستمرة / داخلة / خارجة / صفر حركة في إحدى الفترتين.
export function shipComposition(nowRows: any[], prevRows: any[]) {
  const build = (rows: any[]) => {
    const m = new Map<string, { name: string; agency: string; act: number; trips: number }>();
    for (const r of rows) {
      const k = r.ship_key;
      const o = m.get(k) || { name: r.ship_name_ar || k, agency: r.agency_key, act: 0, trips: 0 };
      o.act += metricOf(r, 'trips') + metricOf(r, 'trucks') + metricOf(r, 'cars') + metricOf(r, 'passengers');
      o.trips += metricOf(r, 'trips');
      m.set(k, o);
    }
    return m;
  };
  const now = build(nowRows), prev = build(prevRows);
  const both: any[] = [], entered: any[] = [], exited: any[] = [], zeroInOne: any[] = [];
  for (const k of new Set([...now.keys(), ...prev.keys()])) {
    const nA = (now.get(k)?.act || 0) > 0, pA = (prev.get(k)?.act || 0) > 0;
    const meta = now.get(k) || prev.get(k)!;
    const entry = { ship: k, name: meta.name, agency: meta.agency, nowTrips: now.get(k)?.trips || 0, prevTrips: prev.get(k)?.trips || 0 };
    if (nA && pA) both.push(entry);
    else if (nA && !pA) entered.push(entry);
    else if (!nA && pA) exited.push(entry);
    else zeroInOne.push(entry);
  }
  return { both, entered, exited, zeroInOne };
}

// اتزان المغادرة/الوصول (لكشف عدم توازن الاتجاهين).
export function directionBalance(rows: any[]): { departureTrucks: number; arrivalTrucks: number; departureCars: number; arrivalCars: number; departurePassengers: number; arrivalPassengers: number } {
  const acc = { departureTrucks: 0, arrivalTrucks: 0, departureCars: 0, arrivalCars: 0, departurePassengers: 0, arrivalPassengers: 0 };
  for (const r of rows) {
    acc.departureTrucks += n(r.departure_trucks_total); acc.arrivalTrucks += n(r.arrival_trucks_total);
    acc.departureCars += n(r.departure_cars); acc.arrivalCars += n(r.arrival_cars);
    acc.departurePassengers += n(r.departure_passengers); acc.arrivalPassengers += n(r.arrival_passengers);
  }
  return acc;
}
