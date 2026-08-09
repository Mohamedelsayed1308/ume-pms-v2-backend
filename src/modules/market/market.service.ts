import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between } from 'typeorm';
import { MarketRecord } from './market-record.entity';
import { AgencyService } from './agency.service';
import {
  METRIC_KEYS, MetricKey, metricOf, ymIndex, monthsInRange, previousPeriod,
  activeMonths, sumMetric, share, aggregateByAgency, productivity, directionBalance,
  sameMonthsPrevYear, growthOf, shareChangePoints, shipComposition,
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

  // ── المقارنة السنوية: نفس الأشهر من العام السابق (إزاحة 12 شهراً) ──
  async yearComparison(f: MarketFilter) {
    const focus = (f.focus || DEFAULT_FOCUS).toUpperCase();
    const ref = sameMonthsPrevYear(f.fromY, f.fromM, f.toY, f.toM);
    const nowRows = await this.loadResolved(f.fromY, f.fromM, f.toY, f.toM);
    const prevRows = await this.loadResolved(ref.fromY, ref.fromM, ref.toY, ref.toM);

    // أشهر فعلية لكل فترة (بها حركة)
    const curMonths = monthsInRange(f.fromY, f.fromM, f.toY, f.toM).filter((m) => nowRows.some((r) => r.year === m.year && r.month_number === m.month));
    const refMonths = monthsInRange(ref.fromY, ref.fromM, ref.toY, ref.toM).filter((m) => prevRows.some((r) => r.year === m.year && r.month_number === m.month));

    // إجمالي السوق للعامين + النمو (المقام دائماً كامل السوق)
    const market = this.metricsOf(nowRows);
    const marketPrev = this.metricsOf(prevRows);
    const marketGrowth = Object.fromEntries(METRIC_KEYS.map((k) => [k, growthOf(market[k], marketPrev[k])])) as Record<MetricKey, ReturnType<typeof growthOf>>;

    // تجميع الوكلاء للعامين
    const aggNow = aggregateByAgency(nowRows);
    const aggPrev = aggregateByAgency(prevRows);
    const agencyKeys = [...new Set([...Object.keys(aggNow), ...Object.keys(aggPrev)])];

    const byAgency = agencyKeys.map((key) => {
      const cur = aggNow[key] || { trips: 0, trucks: 0, cars: 0, passengers: 0, name: aggPrev[key]?.name || key };
      const prev = aggPrev[key] || { trips: 0, trucks: 0, cars: 0, passengers: 0, name: cur.name };
      const curVals: any = {}, prevVals: any = {}, growth: any = {}, sharesCur: any = {}, sharesPrev: any = {}, shareChange: any = {}, contribution: any = {};
      for (const k of METRIC_KEYS) {
        curVals[k] = cur[k]; prevVals[k] = prev[k];
        growth[k] = growthOf(cur[k], prev[k]);
        sharesCur[k] = share(cur[k], market[k]); sharesPrev[k] = share(prev[k], marketPrev[k]);
        shareChange[k] = shareChangePoints(sharesCur[k], sharesPrev[k]); // نقاط مئوية
        const marketAbs = market[k] - marketPrev[k];
        contribution[k] = { abs: cur[k] - prev[k], pctOfMarketGrowth: marketAbs !== 0 ? ((cur[k] - prev[k]) / marketAbs) * 100 : null };
      }
      const agNow = nowRows.filter((r) => r.agency_key === key), agPrev = prevRows.filter((r) => r.agency_key === key);
      return {
        key, name: cur.name, current: curVals, previous: prevVals, growth,
        shares: { current: sharesCur, previous: sharesPrev }, shareChange, contribution,
        productivity: { current: productivity(agNow), previous: productivity(agPrev) },
      };
    }).sort((a, b) => b.current.trips - a.current.trips);

    // ترتيب الوكلاء للعامين (بالرحلات كأساس + كل مؤشر)
    const rankBy = (agg: Record<string, any>, market: Record<MetricKey, number>) => Object.fromEntries(METRIC_KEYS.map((k) => [k,
      Object.entries(agg).map(([ak, av]: any) => ({ key: ak, name: av.name, value: av[k], share: share(av[k], market[k]) })).sort((x, y) => y.value - x.value),
    ])) as Record<MetricKey, any[]>;
    const ranking = { current: rankBy(aggNow, market), previous: rankBy(aggPrev, marketPrev) };

    // أداء التركيز (بدوي) مقابل السوق
    const focusGrowth: any = {}, focusShareChange: any = {};
    for (const k of METRIC_KEYS) {
      const fg = growthOf(aggNow[focus]?.[k] || 0, aggPrev[focus]?.[k] || 0);
      const mg = marketGrowth[k];
      focusGrowth[k] = { focusPct: fg.pct, marketPct: mg.pct, outperformsMarket: fg.pct != null && mg.pct != null ? fg.pct > mg.pct : null, focus: fg };
      const sc = shareChangePoints(share(aggNow[focus]?.[k] || 0, market[k]), share(aggPrev[focus]?.[k] || 0, marketPrev[k]));
      focusShareChange[k] = sc; // + مكسب، − خسارة حصة
    }

    // مساهمة كل سفينة في نمو/تراجع وكالتها (بالرحلات)
    const shipMap: Record<string, { name: string; agency: string; now: number; prev: number }> = {};
    nowRows.forEach((r) => { const s = (shipMap[r.ship_key] = shipMap[r.ship_key] || { name: r.ship_name_ar || r.ship_key, agency: r.agency_key, now: 0, prev: 0 }); s.now += metricOf(r, 'trips'); });
    prevRows.forEach((r) => { const s = (shipMap[r.ship_key] = shipMap[r.ship_key] || { name: r.ship_name_ar || r.ship_key, agency: r.agency_key, now: 0, prev: 0 }); s.prev += metricOf(r, 'trips'); });
    const shipContribution = Object.entries(shipMap).map(([ship, v]) => ({ ship, name: v.name, agency: v.agency, now: v.now, prev: v.prev, delta: v.now - v.prev })).sort((a, b) => b.delta - a.delta);

    // خط شهري متطابق: كل شهر حالي مقابل نفس الشهر من العام السابق (للتركيز والسوق)
    const monthlyOverlay = curMonths.map(({ year, month }) => {
      const curM = nowRows.filter((r) => r.year === year && r.month_number === month);
      const prevM = prevRows.filter((r) => r.year === year - 1 && r.month_number === month);
      const mm = (rows: any[]) => this.metricsOf(rows);
      const focusMetric = (rows: any[], k: MetricKey) => sumMetric(rows.filter((r) => r.agency_key === focus), k);
      return {
        month, label: MONTH_AR[month - 1],
        current: mm(curM), previous: mm(prevM),
        focusCurrent: Object.fromEntries(METRIC_KEYS.map((k) => [k, focusMetric(curM, k)])),
        focusPrevious: Object.fromEntries(METRIC_KEYS.map((k) => [k, focusMetric(prevM, k)])),
      };
    });

    return {
      period: {
        current: { from: { year: f.fromY, month: f.fromM }, to: { year: f.toY, month: f.toM }, months: curMonths.map((m) => ({ ...m, label: monthLabel(m.year, m.month) })) },
        reference: { from: { year: ref.fromY, month: ref.fromM }, to: { year: ref.toY, month: ref.toM }, months: refMonths.map((m) => ({ ...m, label: monthLabel(m.year, m.month) })) },
      },
      focus,
      market: { current: market, previous: marketPrev }, marketGrowth,
      marketTrend: METRIC_KEYS.reduce((s, k) => s + (marketGrowth[k].abs || 0), 0) > 0 ? 'growth' : 'contraction',
      byAgency, ranking,
      focusPerformance: { growthVsMarket: focusGrowth, shareChange: focusShareChange },
      shipContribution,
      composition: shipComposition(nowRows, prevRows),
      productivity: { market: { current: productivity(nowRows), previous: productivity(prevRows) } },
      direction: { current: directionBalance(nowRows), previous: directionBalance(prevRows) },
      monthlyOverlay,
      recordCounts: { current: nowRows.length, previous: prevRows.length },
      hasData: nowRows.length > 0 && prevRows.length > 0,
      agencies: byAgency.map((a) => ({ key: a.key, name: a.name })),
      ships: Object.entries(shipMap).map(([k, v]) => ({ key: k, name: v.name, agency: v.agency })),
      selectedAgencies: f.agencies || null, shipFilter: f.ship || null,
    };
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
      agencies: byAgency.map((a) => ({ key: a.key, name: a.name })),
      ships: Object.values(rows.reduce((acc: any, r) => { acc[r.ship_key] = acc[r.ship_key] || { key: r.ship_key, name: r.ship_name_ar || r.ship_key, agency: r.agency_key }; return acc; }, {})),
    };
  }
}
