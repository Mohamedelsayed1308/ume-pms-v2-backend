/**
 * ═══════════════════════════════════════════════════════════════════════════
 * بذرُ كارت Stone — تحقّقٌ وتخطيطٌ خالصان
 *
 * ── ولماذا لا بياناتَ في هذا الملفّ ──
 * الحمولة تصل **في جسم الطلب** من شاشة المالك، ولا تُودَع في المستودع. فمستودعا
 * المشروع عامّان على الإنترنت، وأرقام قرضٍ بين شركةٍ أمٍّ وتابعتها لا تُنشر.
 *
 * فهذا الملفّ يحمل **الشكل والفحص** لا الأرقام: يتحقّق من الحمولة، ويحسب ما
 * تقوله، ويستخرج كلَّ تعارضٍ فيها — ثمّ يردّ خطّةً تُعرض قبل أن يُكتب شيء.
 *
 * ── والفحص قبل الكتابة، لا بعدها ──
 * البذر يُجرى مرّةً على دفترٍ ماليّ. فخطأٌ فيه يبقى حتّى يكتشفه أحدٌ بعينه —
 * كما بقي نقصُ سيولة يناير شهوراً. فالخطّة تُطبع أوّلاً بكلّ فارق.
 * ═══════════════════════════════════════════════════════════════════════════
 */

export interface SeedRound {
  round_no: number;
  commitment_usd: number;
  plsa_signed_date?: string | null;
  status?: string;
  note?: string;
}

export interface SeedParentMove {
  occurred_at: string;
  direction: 'funding' | 'repayment';
  kind?: 'principal' | 'interest';
  amount_usd: number;
  round_no?: number | null;
  reference?: string;
  note?: string;
}

export interface SeedInvestmentMove {
  round_no: number;
  direction: 'contribution' | 'repatriation';
  seq?: number | null;
  call_date?: string | null;
  paid_date?: string | null;
  amount_usd: number;
  ships?: string;
  source?: 'stone_recap' | 'bee_gl' | 'both';
  status?: 'announced' | 'confirmed' | null;
  /** جولةٌ يُرجَّح أنّ القيد يخصّها — إعلانُ شكٍّ لا نقل */
  suspect_round_no?: number | null;
  note?: string;
}

export interface SeedBank {
  occurred_at: string;
  bank?: string;
  reference?: string;
  amount_usd?: number | null;
  note?: string;
}

export interface SeedFundCall {
  round_no: number;
  as_of: string;
  fund_called_usd?: number | null;
  pct?: number | null;
  note?: string;
}

export interface SeedVessel {
  round_no?: number | null;
  name: string;
  vessel_type?: string;
  built?: number | null;
  hire?: string;
  charter_period?: string;
  delivery?: string;
  pool_coefficient?: string;
  note?: string;
}

export interface SeedOpenItem {
  title: string;
  status?: 'open' | 'sent' | 'closed';
  owner?: string;
  note?: string;
}

export interface SeedPayload {
  rounds: SeedRound[];
  parent?: SeedParentMove[];
  investment?: SeedInvestmentMove[];
  bank?: SeedBank[];
  fund_calls?: SeedFundCall[];
  vessels?: SeedVessel[];
  open_items?: SeedOpenItem[];
}

export interface SeedFinding {
  level: 'error' | 'warn' | 'info';
  text: string;
}

export interface SeedPlan {
  ok: boolean;
  counts: Record<string, number>;
  rounds: {
    round_no: number;
    commitment: number;
    contributed: number;
    contributed_pct: number;
    over_commitment: number;
    repatriated_confirmed: number;
    repatriated_announced: number;
    funded_by_parent: number;
    unfunded_gap: number;
    suspect_count: number;
    suspect_total: number;
  }[];
  findings: SeedFinding[];
}

const r2 = (v: number) => Math.round(v * 100) / 100;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const fmt = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const days = (a: string, b: string) =>
  Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);

/**
 * يفحص الحمولة ويردّ خطّةً — **ولا يكتب شيئاً**.
 *
 * `ok = false` يعني خطأً يمنع البذر. والتحذيرات لا تمنع: هي ما يجب أن تراه
 * قبل أن تقول «اكتبها».
 */
export function planSeed(p: SeedPayload): SeedPlan {
  const F: SeedFinding[] = [];
  const err = (text: string) => F.push({ level: 'error', text });
  const warn = (text: string) => F.push({ level: 'warn', text });
  const info = (text: string) => F.push({ level: 'info', text });

  const rounds = Array.isArray(p?.rounds) ? p.rounds : [];
  if (!rounds.length) err('لا جولاتٍ في الحمولة — ولا شيءَ يُنسَب إليه');

  const nos = new Set<number>();
  for (const r of rounds) {
    if (!Number.isInteger(r.round_no) || r.round_no <= 0) err(`رقم جولةٍ غير صالح: ${r.round_no}`);
    if (nos.has(r.round_no)) err(`الجولة ${r.round_no} مكرّرةٌ في الحمولة`);
    nos.add(r.round_no);
    if (!(Number(r.commitment_usd) > 0)) err(`الجولة ${r.round_no}: التزامٌ موجبٌ مطلوب`);
    if (r.plsa_signed_date && !DATE.test(r.plsa_signed_date)) err(`الجولة ${r.round_no}: تاريخ التوقيع غير صالح`);
  }

  const parent = p.parent ?? [];
  const inv = p.investment ?? [];

  // ── فحص الحركات ──
  parent.forEach((m, i) => {
    if (!DATE.test(String(m.occurred_at))) err(`دفتر الأمّ #${i + 1}: تاريخٌ غير صالح`);
    if (!['funding', 'repayment'].includes(String(m.direction))) err(`دفتر الأمّ #${i + 1}: اتّجاهٌ غير معروف`);
    if (m.kind && !['principal', 'interest'].includes(String(m.kind))) err(`دفتر الأمّ #${i + 1}: نوعٌ غير معروف`);
    if (!(Number(m.amount_usd) > 0)) err(`دفتر الأمّ #${i + 1}: المبلغ موجبٌ دائماً — الاتّجاه يحمل الإشارة`);
    if (m.round_no != null && !nos.has(m.round_no)) err(`دفتر الأمّ #${i + 1}: الجولة ${m.round_no} غير معرَّفة`);
  });

  const deltas: number[] = [];
  inv.forEach((m, i) => {
    if (!nos.has(m.round_no)) err(`دفتر الاستثمار #${i + 1}: الجولة ${m.round_no} غير معرَّفة`);
    if (!['contribution', 'repatriation'].includes(String(m.direction))) err(`دفتر الاستثمار #${i + 1}: اتّجاهٌ غير معروف`);
    if (!(Number(m.amount_usd) > 0)) err(`دفتر الاستثمار #${i + 1}: مبلغٌ موجبٌ مطلوب`);
    if (m.call_date && !DATE.test(m.call_date)) err(`دفتر الاستثمار #${i + 1}: تاريخ نداءٍ غير صالح`);
    if (m.paid_date && !DATE.test(m.paid_date)) err(`دفتر الاستثمار #${i + 1}: تاريخ دفعٍ غير صالح`);
    if (!m.call_date && !m.paid_date) err(`دفتر الاستثمار #${i + 1}: تاريخُ نداءٍ أو دفعٍ مطلوب`);
    if (m.suspect_round_no != null && !nos.has(m.suspect_round_no)) {
      err(`دفتر الاستثمار #${i + 1}: الجولة المشكوكة ${m.suspect_round_no} غير معرَّفة`);
    }
    if (m.direction === 'repatriation' && m.status && !['announced', 'confirmed'].includes(String(m.status))) {
      err(`دفتر الاستثمار #${i + 1}: حالةٌ غير معروفة`);
    }
    if (m.call_date && m.paid_date) {
      const d = days(m.call_date, m.paid_date);
      deltas.push(d);
      /*
       * دفعٌ قبل النداء يقع — لكنّه يستحقّ نظرة. وفارقٌ يتجاوز الشهر يُرجَّح
       * أنّه اقترانُ قيدٍ بغير قرينه.
       */
      if (d < 0) warn(`دفتر الاستثمار #${i + 1}: الدفع (${m.paid_date}) قبل النداء (${m.call_date})`);
      else if (d > 31) warn(`دفتر الاستثمار #${i + 1}: بين النداء والدفع ${d} يوماً — أهُما قرينان؟`);
    }
  });

  if (deltas.length) {
    const mn = Math.min(...deltas), mx = Math.max(...deltas);
    const avg = deltas.reduce((a, b) => a + b, 0) / deltas.length;
    info(`${deltas.length} قيداً بتاريخَي نداءٍ ودفع — الفارق من ${mn} إلى ${mx} يوماً، متوسّطه ${avg.toFixed(1)}`);
  }

  // ── حسبةُ كلّ جولة ──
  const perRound = rounds.map((r) => {
    const mine = inv.filter((x) => x.round_no === r.round_no);
    const commitment = Number(r.commitment_usd) || 0;
    const contributed = r2(mine.filter((x) => x.direction === 'contribution').reduce((a, x) => a + Number(x.amount_usd), 0));
    const rep = mine.filter((x) => x.direction === 'repatriation');
    const repConf = r2(rep.filter((x) => x.status === 'confirmed').reduce((a, x) => a + Number(x.amount_usd), 0));
    const repAnn = r2(rep.filter((x) => x.status !== 'confirmed').reduce((a, x) => a + Number(x.amount_usd), 0));
    const funded = r2(parent
      .filter((m) => m.round_no === r.round_no && (m.kind ?? 'principal') === 'principal' && m.direction === 'funding')
      .reduce((a, m) => a + Number(m.amount_usd), 0));
    const suspects = mine.filter((x) => x.suspect_round_no != null);

    return {
      round_no: r.round_no,
      commitment,
      contributed,
      contributed_pct: commitment ? r2((contributed / commitment) * 100) : 0,
      over_commitment: r2(Math.max(0, contributed - commitment)),
      repatriated_confirmed: repConf,
      repatriated_announced: repAnn,
      funded_by_parent: funded,
      unfunded_gap: r2(contributed - funded),
      suspect_count: suspects.length,
      suspect_total: r2(suspects.reduce((a, x) => a + Number(x.amount_usd), 0)),
    };
  });

  for (const r of perRound) {
    if (r.over_commitment > 0) {
      warn(`الجولة ${r.round_no}: المنادى ${fmt(r.contributed)} يتجاوز الالتزام ${fmt(r.commitment)} بـ ${fmt(r.over_commitment)}`);
    }
    if (r.contributed > 0 && r.funded_by_parent === 0) {
      warn(`الجولة ${r.round_no}: ${fmt(r.contributed)} استُثمرت ولم تُقرض الأمّ شيئاً`);
    } else if (r.unfunded_gap > 0) {
      warn(`الجولة ${r.round_no}: فجوةُ تمويلٍ ${fmt(r.unfunded_gap)} — استُثمرت بلا مقابلٍ من الأمّ`);
    }
    if (r.suspect_count) {
      info(`الجولة ${r.round_no}: ${r.suspect_count} قيداً بمجموع ${fmt(r.suspect_total)} مشكوكٌ في نسبته`);
    }
    if (r.repatriated_announced > 0) {
      info(`الجولة ${r.round_no}: ${fmt(r.repatriated_announced)} استردادٌ مُعلَنٌ لم يُؤكَّد`);
    }
  }

  const counts = {
    rounds: rounds.length,
    parent: parent.length,
    investment: inv.length,
    bank: (p.bank ?? []).length,
    fund_calls: (p.fund_calls ?? []).length,
    vessels: (p.vessels ?? []).length,
    open_items: (p.open_items ?? []).length,
  };

  return { ok: !F.some((f) => f.level === 'error'), counts, rounds: perRound, findings: F };
}
