import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between } from 'typeorm';
import { MarketRecord } from './market-record.entity';
import { AgencyService } from './agency.service';
import {
  METRIC_KEYS, MetricKey, metricOf, ymIndex, monthsInRange, previousPeriod,
  activeMonths, sumMetric, share, aggregateByAgency, productivity, directionBalance,
} from './market.calc';

export interface MarketFilter { fromY: number; fromM: number; toY: number; toM: number; agencies?: string[]; ship?: string; focus?: string; }
const DEFAULT_FOCUS = 'BADAWY';
const MONTH_AR = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
const monthLabel = (y: number, m: number) => `${MONTH_AR[m - 1]} ${y}`;
const pct = (cur: number, prev: number) => (prev > 0 ? (cur - prev) / prev : null);
const zeroMetrics = () => ({ trips: 0, trucks: 0, cars: 0, passengers: 0 } as Record<MetricKey, number>);

@Injectable()
export class MarketService {
  constructor(
    @InjectRepository(MarketRecord) private repo: Repository<MarketRecord>,
    private agency: AgencyService,
  ) {}

  // يحمّل سجلات فترة ويحلّ الوكيل الفعلي لكل سجل حسب الشهر (من تاريخ الوكالة)، مع استبعاد أشهر بلا حركة سوق.
  private async loadResolved(fromY: number, fromM: number, toY: number, toM: number) {
    const start = `${fromY}-${String(fromM).padStart(2, '0')}-01`;
    const end = `${toY}-${String(toM).padStart(2, '0')}-31`;
    const recs = await this.repo.find({ where: { period_start: Between(start, end) } as any });
    const hist = await this.agency.resolveMap();
    const rows = recs.map((r) => {
      const resolved = AgencyService.resolveFrom(hist[r.ship_key], r.year, r.month_number);
      return { ...r, agency_key: resolved?.agency_key || r.agency_key || '—', agency_name_ar: resolved?.agency_name_ar || r.agency_name_ar || r.agency_key };
    });
    const active = activeMonths(rows);
    return rows.filter((r) => active.has(ymIndex(r.year, r.month_number)));
  }

  private metricsOf(rows: any[]): Record<MetricKey, number> {
    const o = zeroMetrics(); for (const k of METRIC_KEYS) o[k] = sumMetric(rows, k); return o;
  }

  async analysis(f: MarketFilter) {
    const focus = (f.focus || DEFAULT_FOCUS).toUpperCase();
    const rows = await this.loadResolved(f.fromY, f.fromM, f.toY, f.toM);
    const months = monthsInRange(f.fromY, f.fromM, f.toY, f.toM)
      .filter((m) => rows.some((r) => r.year === m.year && r.month_number === m.month));

    // الفترة السابقة المكافئة
    const pp = previousPeriod(f.fromY, f.fromM, f.toY, f.toM);
    const prevRows = await this.loadResolved(pp.fromY, pp.fromM, pp.toY, pp.toM);
    const hasComparison = prevRows.length > 0;

    // إجمالي السوق (المقام دائماً كامل السوق)
    const market = this.metricsOf(rows);
    const marketPrev = hasComparison ? this.metricsOf(prevRows) : null;

    // تجميع لكل وكيل (كل السوق)
    const aggNow = aggregateByAgency(rows);
    const aggPrev = aggregateByAgency(prevRows);
    const shipsByAgency: Record<string, Set<string>> = {};
    rows.forEach((r) => (shipsByAgency[r.agency_key] = shipsByAgency[r.agency_key] || new Set()).add(r.ship_key));

    const byAgency = Object.entries(aggNow).map(([key, a]: any) => {
      const prev = aggPrev[key];
      const shares: any = {}, changes: any = {};
      for (const k of METRIC_KEYS) { shares[k] = share(a[k], market[k]); changes[k] = prev ? pct(a[k], prev[k]) : null; }
      // اعتماد على سفينة واحدة: أعلى حصة سفينة داخل الوكيل (بالرحلات)
      const agRows = rows.filter((r) => r.agency_key === key);
      const byShip: Record<string, number> = {};
      agRows.forEach((r) => (byShip[r.ship_key] = (byShip[r.ship_key] || 0) + metricOf(r, 'trips')));
      const shipTotals = Object.values(byShip); const agTrips = shipTotals.reduce((s, v) => s + v, 0);
      const topShipShare = agTrips ? Math.max(...shipTotals) / agTrips : 0;
      return { key, name: a.name, values: { trips: a.trips, trucks: a.trucks, cars: a.cars, passengers: a.passengers }, shares, changes, productivity: productivity(agRows), shipCount: (shipsByAgency[key] || new Set()).size, topShipShare };
    }).sort((x, y) => y.values.trips - x.values.trips);

    // ترتيب الوكلاء لكل مؤشر
    const ranking: Record<MetricKey, { key: string; name: string; value: number; share: number }[]> = {} as any;
    for (const k of METRIC_KEYS) {
      ranking[k] = byAgency.map((a) => ({ key: a.key, name: a.name, value: a.values[k], share: a.shares[k] }))
        .sort((x, y) => y.value - x.value);
    }

    // مؤشرات التركيز (بدوي): العدد + الحصة + الترتيب + التغيّر
    const kpis: any = {};
    for (const k of METRIC_KEYS) {
      const val = aggNow[focus]?.[k] || 0;
      const prevVal = aggPrev[focus]?.[k] ?? null;
      const rank = ranking[k].findIndex((r) => r.key === focus) + 1;
      kpis[k] = { value: val, share: share(val, market[k]), rank: rank || null, agencies: ranking[k].length, prev: prevVal, changePct: prevVal != null ? pct(val, prevVal) : null };
    }

    // خط زمني شهري: حصة كل وكيل لكل مؤشر
    const timeline = months.map(({ year, month }) => {
      const mRows = rows.filter((r) => r.year === year && r.month_number === month);
      const mMarket = this.metricsOf(mRows);
      const agg = aggregateByAgency(mRows);
      const byAgencyShare: any = {};
      for (const [ak, av] of Object.entries(agg) as any) {
        byAgencyShare[ak] = {} as any;
        for (const k of METRIC_KEYS) byAgencyShare[ak][k] = { value: av[k], share: share(av[k], mMarket[k]) };
      }
      return { year, month, label: monthLabel(year, month), market: mMarket, byAgencyShare };
    });

    // أداء التركيز (بدوي) شهرياً + أفضل/أسوأ شهر (بالرحلات) + السفن المساهمة في النمو/التراجع
    const focusMonthly = timeline.map((t) => {
      const av = t.byAgencyShare[focus] || {};
      const v: any = { year: t.year, month: t.month, label: t.label };
      for (const k of METRIC_KEYS) { v[k] = av[k]?.value || 0; v[`${k}Share`] = av[k]?.share || 0; }
      return v;
    });
    let bestMonth: any = null, worstMonth: any = null;
    focusMonthly.forEach((m) => { if (!bestMonth || m.trips > bestMonth.trips) bestMonth = m; if (!worstMonth || m.trips < worstMonth.trips) worstMonth = m; });

    // السفن التي ساهمت في نمو/تراجع التركيز (فرق الرحلات مقابل الفترة السابقة لكل سفينة)
    const focusNow = rows.filter((r) => r.agency_key === focus);
    const focusPrev = prevRows.filter((r) => r.agency_key === focus);
    const shipDelta: Record<string, { name: string; now: number; prev: number }> = {};
    focusNow.forEach((r) => { const s = (shipDelta[r.ship_key] = shipDelta[r.ship_key] || { name: r.ship_name_ar || r.ship_key, now: 0, prev: 0 }); s.now += metricOf(r, 'trips'); });
    focusPrev.forEach((r) => { const s = (shipDelta[r.ship_key] = shipDelta[r.ship_key] || { name: r.ship_name_ar || r.ship_key, now: 0, prev: 0 }); s.prev += metricOf(r, 'trips'); });
    const contributingShips = Object.entries(shipDelta).map(([k, v]) => ({ ship: k, name: v.name, now: v.now, prev: v.prev, delta: v.now - v.prev }))
      .sort((a, b) => b.delta - a.delta);

    return {
      period: { from: { year: f.fromY, month: f.fromM }, to: { year: f.toY, month: f.toM }, months: months.map((m) => ({ ...m, label: monthLabel(m.year, m.month) })) },
      excludedMonths: monthsInRange(f.fromY, f.fromM, f.toY, f.toM).filter((m) => !months.some((x) => x.year === m.year && x.month === m.month)).map((m) => monthLabel(m.year, m.month)),
      focus, hasComparison, prevPeriod: hasComparison ? { from: { year: pp.fromY, month: pp.fromM }, to: { year: pp.toY, month: pp.toM } } : null,
      market, marketPrev, marketChange: marketPrev ? Object.fromEntries(METRIC_KEYS.map((k) => [k, pct(market[k], marketPrev[k])])) : null,
      kpis, byAgency, ranking, timeline, focusMonthly, bestMonth, worstMonth, contributingShips,
      productivity: { market: productivity(rows) },
      direction: { market: directionBalance(rows), focus: directionBalance(focusNow) },
      // حقول مستقبلية: غير متاحة (لا تُختلق)
      optional: { profitability: 'unavailable', capacity: 'unavailable', customers: 'unavailable' },
      selectedAgencies: f.agencies || null, shipFilter: f.ship || null,
      recordCount: rows.length,
    };
  }
}
