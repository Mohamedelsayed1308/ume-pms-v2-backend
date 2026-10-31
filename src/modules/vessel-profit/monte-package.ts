/*
 * تحقّق حزمة رحلات مونتي (`monte_pms.json`، الشكل `monte-pms/1`) في الخادم.
 *
 * نسخةٌ من `validateMontePackage` في الفرونت (`lib/reports/montePackage.ts`) — القواعد نفسها
 * والرسائل نفسها. كانت في الواجهة وحدها لأنّ الرفع كان بزرّ الأدمن هناك؛ أمّا الدفع الآليّ
 * من جلسة مونتي (٣٠ أكتوبر ٢٠٢٦) فلا يمرّ بالواجهة، فيُعاد الفحص هنا قبل الحفظ.
 * أيّ تغييرٍ في القواعد يُنقل إلى النسختين معاً.
 *
 * رحلة 07 محجوبة بقرار المالك: تُنزع قبل الفحص، والحزمة تُحفظ كما وصلت.
 *
 * بنود السفينة الثابتة المستجدّة (مؤن · تجهيز · صيانة…) تأتي في `monthly[].fixed_items`
 * `{ key, label, usd }` وتدخل في مجموع الثابتة — ٣١ أكتوبر ٢٠٢٦، فبندٌ جديد لا يحتاج كوداً.
 */
export const MONTE_SCHEMA = 'monte-pms/1';
export const HIDDEN_VOYAGES = ['07'];

const REV_FIELDS = ['rev_pax_out', 'rev_pax_ret', 'rev_cargo_out', 'rev_cargo_ret', 'rev_do', 'rev_other'];
const COST_FIELDS = [
  'cost_fuel', 'cost_water', 'cost_port_jed', 'cost_comm_jed', 'cost_port_suk',
  'cost_comm_suk30', 'cost_comm_suk', 'cost_agent_adj', 'cost_gifts', 'cost_catering',
];
const SECTIONS = ['voyages', 'legs', 'monthly', 'fuel_stock', 'agent_voyages', 'agent_summary', 'line_compare', 'rules', 'pending'];

const r2 = (n: number) => Math.round(n * 100) / 100;
const n0 = (x: unknown) => (typeof x === 'number' && isFinite(x) ? x : 0);
const TOL = 0.05; // تقريب السنتات عبر عشرات البنود
const monthOf = (d: unknown) => String(d || '').slice(0, 7);

function voyageNet(v: any) {
  const rev = r2(REV_FIELDS.reduce((s, k) => s + n0(v[k]), 0));
  const cost = r2(COST_FIELDS.reduce((s, k) => s + n0(v[k]), 0));
  return { rev, cost, net: r2(rev - cost) };
}

function itemTotals(v: any) {
  let rev = 0, cost = 0, excluded = 0;
  for (const i of v.items || []) {
    if (i.excluded) excluded += n0(i.usd);
    else if (i.kind === 'rev') rev += n0(i.usd);
    else cost -= n0(i.usd);
  }
  return { rev: r2(rev), cost: r2(cost), excluded: r2(excluded) };
}

export interface MonteCheck { ok: boolean; errors: string[]; warnings: string[]; voyages: number; hidden: string[]; generatedAt: string | null }

export function validateMontePackage(raw: unknown): MonteCheck {
  const errors: string[] = [], warnings: string[] = [];
  const fail = (e: string): MonteCheck => ({ ok: false, errors: [e], warnings, voyages: 0, hidden: [], generatedAt: null });
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return fail('الملفّ ليس كائن JSON');
  const p = raw as any;
  if (p.schema !== MONTE_SCHEMA) return fail(`الشكل «${String(p.schema)}» غير مدعوم — المتوقَّع ${MONTE_SCHEMA}`);
  for (const k of SECTIONS) if (!Array.isArray(p[k])) return fail(`القسم ${k} مفقود أو ليس قائمة`);
  if (!p.vessel || typeof p.vessel !== 'object') return fail('القسم vessel مفقود');

  const hide = (x: any) => HIDDEN_VOYAGES.includes(String(x?.voyage));
  const hidden = [...new Set<string>(p.voyages.filter(hide).map((v: any) => String(v.voyage)))];
  const voyages = p.voyages.filter((x: any) => !hide(x));
  if (!voyages.length) return fail('لا رحلات في الحزمة');

  const seen = new Set<string>();
  for (const v of voyages) {
    const id = String(v?.voyage);
    if (seen.has(id)) errors.push(`الرحلة ${id} مكرّرة`);
    seen.add(id);
    for (const k of [...REV_FIELDS, ...COST_FIELDS]) {
      if (typeof v[k] !== 'number' || !isFinite(v[k])) errors.push(`الرحلة ${id}: الحقل ${k} ليس رقماً`);
    }
    if (!Array.isArray(v.items) || !v.items.length) { errors.push(`الرحلة ${id}: لا بنود`); continue; }
    const t = voyageNet(v), it = itemTotals(v);
    if (Math.abs(t.rev - it.rev) > TOL) errors.push(`الرحلة ${id}: بنود الإيراد ${it.rev} لا تساوي حقوله ${t.rev}`);
    if (Math.abs(t.cost - it.cost) > TOL) errors.push(`الرحلة ${id}: بنود التكاليف ${it.cost} لا تساوي حقولها ${t.cost}`);
    const badEx = v.items.filter((i: any) => i?.excluded && i.kind !== 'cost');
    if (badEx.length) errors.push(`الرحلة ${id}: بند إيرادٍ مستبعَد (${badEx[0].label}) — المستبعَد الإيجار وحده`);
    if (Math.abs(it.excluded + n0(v.hire_in_file)) > TOL) warnings.push(`الرحلة ${id}: المستبعَد ${-it.excluded} لا يساوي إيجار الملفّ ${v.hire_in_file}`);
    if (n0(v.cost_catering) !== 0) warnings.push(`الرحلة ${id}: كاترينج ${v.cost_catering} — مؤن السفينة في الشهريّ لا على الرحلة`);
  }

  for (const m of p.monthly) {
    const vs = voyages.filter((v: any) => monthOf(v.dep) === m?.month);
    const vnet = r2(vs.reduce((s: number, v: any) => s + voyageNet(v).net, 0));
    if (Math.abs(vnet - n0(m.vnet)) > TOL) errors.push(`شهر ${m.month}: صافي الرحلات ${m.vnet} ورحلاته المعروضة ${vnet}`);
    if (vs.length !== n0(m.trips)) errors.push(`شهر ${m.month}: ${m.trips} رحلة والمعروض ${vs.length}`);
    let items = 0;
    if (m.fixed_items != null) {
      if (!Array.isArray(m.fixed_items)) { errors.push(`شهر ${m.month}: fixed_items ليس قائمة`); continue; }
      const keys = new Set<string>();
      for (const i of m.fixed_items) {
        if (!i || typeof i.key !== 'string' || !i.key || typeof i.label !== 'string' || !i.label) { errors.push(`شهر ${m.month}: بندٌ ثابت بلا مفتاحٍ أو اسم`); continue; }
        if (typeof i.usd !== 'number' || !isFinite(i.usd)) errors.push(`شهر ${m.month}: البند ${i.label} ليس رقماً`);
        if (keys.has(i.key)) errors.push(`شهر ${m.month}: البند ${i.label} مكرّر`);
        keys.add(i.key);
        if (i.usd > 0) warnings.push(`شهر ${m.month}: البند ${i.label} موجب ${i.usd} — التكاليف بالسالب`);
        items += n0(i.usd);
      }
    }
    const fixed = r2(n0(m.ins) + n0(m.sal_usd) + n0(m.sal_eur) + n0(m.crew_misc) + n0(m.ctm) + items);
    if (Math.abs(fixed - n0(m.fixed)) > TOL) errors.push(`شهر ${m.month}: الثابتة ${m.fixed} ومكوّناتها ${fixed}`);
    const net = r2(n0(m.vnet) + n0(m.pos) + n0(m.fixed));
    if (Math.abs(net - n0(m.net)) > TOL) errors.push(`شهر ${m.month}: الصافي ${m.net} ومكوّناته ${net}`);
    if (m.salaries_pending) warnings.push(`شهر ${m.month}: المرتّبات لم تُدخَل بعد — الصافي قبلها`);
  }
  const months = new Set(p.monthly.map((m: any) => m?.month));
  for (const v of voyages) if (!months.has(monthOf(v.dep))) errors.push(`الرحلة ${v.voyage}: شهرها ${monthOf(v.dep)} ليس في الجدول الشهريّ`);

  return {
    ok: !errors.length, errors, warnings, voyages: voyages.length, hidden,
    generatedAt: typeof p.generated_at === 'string' ? p.generated_at : null,
  };
}
