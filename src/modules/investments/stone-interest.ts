/**
 * ═══════════════════════════════════════════════════════════════════════════
 * محرّك الفائدة على قرض الأمّ — ودالّةٌ خالصةٌ عمداً
 *
 * ── ما يفعله وما لا يفعله ──
 * يحسب فائدةً **تقديريّة** على الرصيد القائم يوماً بيوم. ولا يكتب قيداً ولا
 * يمسّ قاعدة: مخرجُه رقمٌ يُعرض بوسم «تقديريّ»، ولا يدخل دفتر الأمّ إلا
 * بمصادقةٍ صريحةٍ من المالك.
 *
 * وهي القاعدة نفسها التي حكمت توزيع الأرباح: يُحسب ويُعرض، ثمّ يُصادَق، ثمّ
 * يُقيَّد. فرقمٌ يدخل دفتراً ماليّاً بلا كلمةِ إنسانٍ خطأٌ مهما صحّ حسابه.
 *
 * ── ولماذا خالصة ──
 * لا مستودعات ولا حقن: تأخذ حركاتٍ وشروطاً وتردّ جدولاً. فتُختبر بالسنت بلا
 * قاعدةٍ ولا خادم — وهذا ما يجعل مراجعتها ممكنة.
 * ═══════════════════════════════════════════════════════════════════════════
 */

/** حركةٌ في دفتر الأمّ — مصغّرةٌ إلى ما يلزم الحساب وحده. */
export interface ParentMove {
  occurred_at: string;                 // YYYY-MM-DD
  direction: 'funding' | 'repayment';
  kind: 'principal' | 'interest';
  amount_usd: number;
}

export interface InterestTerm {
  effective_from: string;              // YYYY-MM-DD
  rate_pct: number;                    // سنويّة، ٪
  day_count: string;                   // 'ACT/365' | 'ACT/360'
  is_agreed: boolean;
}

export interface InterestSlice {
  from: string;
  to: string;                          // شاملٌ
  days: number;
  principal: number;                   // الرصيد القائم خلال الشريحة
  rate_pct: number;
  day_count: string;
  interest: number;
}

export interface InterestResult {
  /** لا شرطَ مُدخَل إطلاقاً ⇒ لا فائدةَ مُتّفقٌ عليها، ولا حساب */
  hasTerms: boolean;
  /** كلّ الشروط المستعملة موقَّعة؟ فإن لا، فالرقم تقديريٌّ يُعلن */
  agreed: boolean;
  slices: InterestSlice[];
  accrued: number;                     // مجموع الفائدة المستحقّة حتّى `asOf`
  paid: number;                        // ما سُدّد منها فعلاً (kind = interest)
  outstanding: number;                 // accrued − paid
  /** الرصيد القائم من الأصل عند `asOf` */
  principalOutstanding: number;
}

const r2 = (v: number) => Math.round(v * 100) / 100;
const DAY = 86400000;
const d = (s: string) => Date.parse(`${s}T00:00:00Z`);
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** عدد أيام السنة بحسب الأساس — وما لم يُعرف يُعامَل 365. */
export function yearDays(dayCount: string): number {
  return String(dayCount).trim().toUpperCase() === 'ACT/360' ? 360 : 365;
}

/**
 * الرصيد القائم من **الأصل** وحده.
 *
 * الفائدة لا تُنقص الأصل ولا تزيده — تُتابَع منفصلةً. فسدادُ فائدةٍ لا يُغيّر
 * ما تدين به التابعة من رأس المال، وخلطُهما يجعل «كم بقي؟» سؤالاً بلا جواب.
 */
export function principalAt(moves: ParentMove[], asOf: string): number {
  const limit = d(asOf);
  let bal = 0;
  for (const m of moves) {
    if (m.kind !== 'principal') continue;
    if (d(m.occurred_at) > limit) continue;
    bal += m.direction === 'funding' ? m.amount_usd : -m.amount_usd;
  }
  return r2(bal);
}

/**
 * فائدةٌ مستحقّةٌ حتّى تاريخ.
 *
 * ── كيف تُقسَّم الفترة ──
 * عند كلّ تاريخٍ يتغيّر فيه الأصل أو تبدأ فيه شروطٌ جديدة، تُقطع شريحة. فكلُّ
 * شريحةٍ رصيدُها ثابتٌ ونسبتُها ثابتة، وحسابُها ضربٌ واحد.
 *
 * ── ولماذا لا يُحسب قبل أوّل شرط ──
 * لأنّ الشرط هو ما يجعل الفائدة موجودةً أصلاً. وما قبل `effective_from` لا
 * فائدةَ فيه — لا صفراً بالحساب، بل غياباً بالتعريف.
 *
 * ── ولا تركيب ──
 * فائدةٌ بسيطةٌ على الأصل وحده. والتركيب قرارٌ تعاقديٌّ لا يُفترض.
 */
export function accrueInterest(
  moves: ParentMove[],
  terms: InterestTerm[],
  asOf: string,
): InterestResult {
  const principalOutstanding = principalAt(moves, asOf);
  const paid = r2(
    moves
      .filter((m) => m.kind === 'interest' && m.direction === 'repayment' && d(m.occurred_at) <= d(asOf))
      .reduce((a, m) => a + m.amount_usd, 0),
  );

  const sorted = [...terms].sort((a, b) => d(a.effective_from) - d(b.effective_from));
  if (!sorted.length) {
    return {
      hasTerms: false, agreed: false, slices: [], accrued: 0,
      paid, outstanding: r2(-paid), principalOutstanding,
    };
  }

  const end = d(asOf);
  const start = d(sorted[0].effective_from);
  if (end < start) {
    return {
      hasTerms: true, agreed: sorted.every((t) => t.is_agreed), slices: [], accrued: 0,
      paid, outstanding: r2(-paid), principalOutstanding,
    };
  }

  // نقاط القطع: بداية كلّ شرطٍ + كلّ يومٍ تغيّر فيه الأصل، داخل المدى
  const cuts = new Set<number>([start]);
  for (const t of sorted) { const x = d(t.effective_from); if (x > start && x <= end) cuts.add(x); }
  for (const m of moves) {
    if (m.kind !== 'principal') continue;
    const x = d(m.occurred_at);
    if (x > start && x <= end) cuts.add(x);
  }
  const points = [...cuts].sort((a, b) => a - b);

  const termAt = (ms: number) => {
    let cur = sorted[0];
    for (const t of sorted) if (d(t.effective_from) <= ms) cur = t;
    return cur;
  };

  const slices: InterestSlice[] = [];
  for (let i = 0; i < points.length; i++) {
    const from = points[i];
    // الشريحة تنتهي قبل نقطة القطع التالية بيوم — والأخيرة تنتهي عند `asOf`
    const to = i + 1 < points.length ? points[i + 1] - DAY : end;
    if (to < from) continue;
    const days = Math.round((to - from) / DAY) + 1;   // شاملُ الطرفين
    const p = principalAt(moves, iso(from));
    const t = termAt(from);
    if (p <= 0 || t.rate_pct <= 0) continue;
    const interest = r2((p * (t.rate_pct / 100) * days) / yearDays(t.day_count));
    slices.push({
      from: iso(from), to: iso(to), days,
      principal: p, rate_pct: t.rate_pct, day_count: t.day_count, interest,
    });
  }

  const accrued = r2(slices.reduce((a, s) => a + s.interest, 0));
  return {
    hasTerms: true,
    agreed: sorted.every((t) => t.is_agreed),
    slices,
    accrued,
    paid,
    outstanding: r2(accrued - paid),
    principalOutstanding,
  };
}
