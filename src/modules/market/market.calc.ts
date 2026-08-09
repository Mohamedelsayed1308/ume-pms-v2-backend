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
