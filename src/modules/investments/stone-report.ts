/**
 * ═══════════════════════════════════════════════════════════════════════════
 * تقرير الإدارة لكارت Stone — الجزء الخالص
 *
 * ── المبدأ ──
 * **الأرقام من المحرّك، والسرد من النموذج.** هذا الملفّ يبني «الأرقام» من
 * الكارت بلا نداءٍ خارجيّ، ويفحص السرد بعد عودته: كلّ رقمٍ في النصّ يجب أن
 * يكون رقماً أعطيناه. فالنموذج لا يحسب ولا يخمّن — يشرح.
 *
 * ── ولماذا الفحص لا الثقة ──
 * تقريرٌ إداريٌّ برقمٍ مخترَع أسوأ من تقريرٍ بلا سرد. فرقمٌ لم يُطابق يُعاد
 * السرد مرّةً، وإن بقي يُعرض مع تحذيرٍ صريحٍ يسمّي الأرقام غير المطابقة —
 * ولا يُخفى.
 * ═══════════════════════════════════════════════════════════════════════════
 */

export type ReportLang = 'ar' | 'en';
export const REPORT_LANGS: readonly ReportLang[] = ['ar', 'en'] as const;

const r2 = (v: number) => Math.round(v * 100) / 100;

/** ما يعرفه المحرّك عن جولةٍ — الحقول التي يحتاجها التقرير فقط. */
export interface RoundFigures {
  round_no: number;
  commitment: number;
  contributed: number;
  contributed_pct: number;
  funded_by_parent: number;
  repat_confirmed: number;
  repat_announced: number;
  capital_returned: number;
  capital_at_stone: number;
  realized_gain: number;
  bee_share_pct: number | null;
  fund_report: {
    as_of: string;
    fund_size_usd: number;
    fund_called_usd: number | null;
    result_period_usd: number | null;
    result_cumulative_usd: number;
    vessels_count: number | null;
    source: string;
  } | null;
  book_result_share: number | null;
  book_value: number | null;
  vessels_named: number;
}

export interface ReportFigures {
  as_of: string;
  currency: 'USD';
  basis: string;
  parent_loan: {
    funded: number;
    repaid: number;
    outstanding: number;
    interest_has_terms: boolean;
    interest_agreed: boolean;
    interest_rate_pct: number | null;
    interest_outstanding: number;
  };
  totals: {
    invested: number;
    returned_confirmed: number;
    returned_announced: number;
    capital_at_stone: number;
    realized_gain: number;
    book_result_share: number | null;
    book_value: number | null;
  };
  rounds: RoundFigures[];
  recent_events: { date: string; text: string }[];
  open_items: { open: number; titles: string[] };
  alerts: string[];
}

/** الحدّ الأدنى ممّا يردّه `InvestmentsService.card()` وتحتاجه الأرقام. */
export interface CardLike {
  as_of: string;
  summary: {
    borrowed_from_parent: number; repaid_to_parent: number; outstanding_to_parent: number;
    invested_in_stone: number; returned_confirmed: number; returned_announced: number;
    interest_outstanding: number; interest_has_terms: boolean; interest_agreed: boolean;
  };
  rounds: {
    id: string; round_no: number; commitment: number; contributed: number; contributed_pct: number;
    funded_by_parent: number; repat_confirmed: number; repat_announced: number;
    capital_returned: number; capital_at_stone: number; realized_gain: number;
    bee_share_pct: number | null; book_result_share: number | null; book_value: number | null;
    vessels: number;
    fund_report: RoundFigures['fund_report'];
  }[];
  parent_ledger: { occurred_at: string; direction: string; kind: string; amount_usd: string; round_id: string | null }[];
  investment_ledger: { round_id: string; direction: string; call_date: string | null; paid_date: string | null; amount_usd: string; status: string | null }[];
  interest_terms: { rate_pct: string; is_agreed: boolean }[];
  open_items: { title: string; status: string }[];
  alerts: { text: string }[];
}

/** يبني الأرقام من الكارت — تحديدٌ خالص، لا نداءَ فيه. */
export function buildFigures(card: CardLike): ReportFigures {
  const roundNo = new Map(card.rounds.map((r) => [r.id, r.round_no]));
  const n = (v: unknown) => Number(v) || 0;

  const events: { date: string; text: string; sort: string }[] = [];
  for (const m of card.parent_ledger) {
    events.push({
      date: m.occurred_at, sort: m.occurred_at,
      text: `${m.direction === 'funding' ? 'UME Holdings → Bee' : 'Bee → UME Holdings'} ${m.kind} ${n(m.amount_usd).toLocaleString('en-US')}`,
    });
  }
  for (const m of card.investment_ledger) {
    const d = m.paid_date || m.call_date || '';
    const rn = roundNo.get(m.round_id);
    events.push({
      date: d, sort: d,
      text: m.direction === 'contribution'
        ? `Bee → Stone ${rn ?? '?'} contribution ${n(m.amount_usd).toLocaleString('en-US')}${m.paid_date ? '' : ' (call, not yet paid)'}`
        : `Stone ${rn ?? '?'} → Bee repatriation ${n(m.amount_usd).toLocaleString('en-US')} (${m.status || 'announced'})`,
    });
  }
  events.sort((a, b) => (a.sort < b.sort ? 1 : a.sort > b.sort ? -1 : 0));

  const agreedTerm = card.interest_terms.find((t) => t.is_agreed);
  const bookTotal = card.rounds.some((r) => r.book_result_share != null)
    ? r2(card.rounds.reduce((a, r) => a + (r.book_result_share ?? 0), 0))
    : null;

  return {
    as_of: card.as_of,
    currency: 'USD',
    basis: 'Management accounts — unaudited. Figures derived from the Stone card ledgers; fund results from CTM quarterly reports.',
    parent_loan: {
      funded: card.summary.borrowed_from_parent,
      repaid: card.summary.repaid_to_parent,
      outstanding: card.summary.outstanding_to_parent,
      interest_has_terms: card.summary.interest_has_terms,
      interest_agreed: card.summary.interest_agreed,
      interest_rate_pct: agreedTerm ? n(agreedTerm.rate_pct) : null,
      interest_outstanding: card.summary.interest_outstanding,
    },
    totals: {
      invested: card.summary.invested_in_stone,
      returned_confirmed: card.summary.returned_confirmed,
      returned_announced: card.summary.returned_announced,
      capital_at_stone: r2(card.rounds.reduce((a, r) => a + r.capital_at_stone, 0)),
      realized_gain: r2(card.rounds.reduce((a, r) => a + r.realized_gain, 0)),
      book_result_share: bookTotal,
      book_value: bookTotal == null ? null : r2(card.rounds.reduce((a, r) => a + (r.book_value ?? r.capital_at_stone), 0)),
    },
    rounds: card.rounds.map((r) => ({
      round_no: r.round_no,
      commitment: r.commitment,
      contributed: r.contributed,
      contributed_pct: r.contributed_pct,
      funded_by_parent: r.funded_by_parent,
      repat_confirmed: r.repat_confirmed,
      repat_announced: r.repat_announced,
      capital_returned: r.capital_returned,
      capital_at_stone: r.capital_at_stone,
      realized_gain: r.realized_gain,
      bee_share_pct: r.bee_share_pct,
      fund_report: r.fund_report,
      book_result_share: r.book_result_share,
      book_value: r.book_value,
      vessels_named: r.vessels,
    })),
    recent_events: events.slice(0, 8).map(({ date, text }) => ({ date, text })),
    open_items: {
      open: card.open_items.filter((i) => i.status === 'open').length,
      titles: card.open_items.filter((i) => i.status === 'open').map((i) => i.title).slice(0, 8),
    },
    alerts: card.alerts.map((a) => a.text),
  };
}

// ── حارس الأرقام ─────────────────────────────────────────────────────────

/**
 * كلّ رقمٍ يجوز للسرد أن يذكره.
 *
 * يُضاف كلّ رقمٍ في الأرقام بصيغه المعقولة: صحيحاً، وبكسرٍ أو كسرين، وبالآلاف
 * والملايين مقرَّباً — لأنّ «1.14 M» و«1,137,500» رقمٌ واحد. والنِّسب تُضاف
 * بصيغة المئة.
 */
export function allowedNumbers(fig: ReportFigures): Set<string> {
  const out = new Set<string>();
  const add = (v: unknown) => {
    const x = Number(v);
    if (!Number.isFinite(x)) return;
    const a = Math.abs(x);
    for (const s of [a.toFixed(0), a.toFixed(1), a.toFixed(2), String(a)]) out.add(norm(s));
    if (a >= 1000) for (const s of [(a / 1e3).toFixed(0), (a / 1e3).toFixed(1), (a / 1e3).toFixed(2)]) out.add(norm(s));
    if (a >= 1e5) for (const s of [(a / 1e6).toFixed(0), (a / 1e6).toFixed(1), (a / 1e6).toFixed(2), (a / 1e6).toFixed(3)]) out.add(norm(s));
    if (a > 0 && a <= 1) for (const s of [(a * 100).toFixed(0), (a * 100).toFixed(1), (a * 100).toFixed(2)]) out.add(norm(s));
  };
  const walk = (v: unknown) => {
    if (v == null) return;
    if (typeof v === 'number') add(v);
    else if (typeof v === 'string') { for (const m of v.match(/\d[\d,]*(?:\.\d+)?/g) || []) add(m.replace(/,/g, '')); }
    else if (Array.isArray(v)) v.forEach(walk);
    else if (typeof v === 'object') Object.values(v as Record<string, unknown>).forEach(walk);
  };
  walk(fig);
  return out;
}

function norm(s: string): string {
  // 1,137,500.00 → 1137500 · 2.50 → 2.5
  const x = Number(String(s).replace(/,/g, ''));
  if (!Number.isFinite(x)) return s;
  return String(Math.round(x * 1000) / 1000);
}

/**
 * يعيد الأرقام التي ذكرها السرد ولم نعطها.
 *
 * تُهمل السنوات (2024–2035)، والأعداد الصغيرة حتّى 100 (نِسبٌ وعدّاتٌ وأيّام
 * التواريخ)، وأجزاء التواريخ. وما بقي يجب أن يكون في المسموح.
 */
export function unmatchedNumbers(text: string, allowed: Set<string>): string[] {
  const bad = new Set<string>();
  const cleaned = text
    // التواريخ بصيغها الشائعة تُزال كاملةً قبل الفحص
    .replace(/\b\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}\b/g, ' ')
    .replace(/\b\d{4}-\d{2}-\d{2}\b/g, ' ')
    .replace(/\b\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?\s+\d{4}\b/gi, ' ');
  for (const m of cleaned.match(/\d[\d,]*(?:\.\d+)?/g) || []) {
    const x = Number(m.replace(/,/g, ''));
    if (!Number.isFinite(x)) continue;
    if (x <= 100) continue;
    if (x >= 2024 && x <= 2035 && Number.isInteger(x)) continue;
    if (!allowed.has(norm(m))) bad.add(m);
  }
  return [...bad];
}

// ── الموجّه والأداة ──────────────────────────────────────────────────────

export const REPORT_TOOL = {
  name: 'write_management_report',
  description: 'Write the management report sections. Every number must come verbatim from FIGURES.',
  input_schema: {
    type: 'object',
    properties: {
      title: { type: 'string' },
      headline: { type: 'string', description: 'One sentence: where the investment stands today.' },
      overview: { type: 'string', description: 'Position in 3–5 sentences: invested, returned, capital still at Stone, parent loan.' },
      round7: { type: 'string', description: 'Round 7 in 3–4 sentences.' },
      round8: { type: 'string', description: 'Round 8 in 3–4 sentences.' },
      returns: { type: 'string', description: 'Realized gain vs book share of fund result, 3–4 sentences. Say plainly if realized gain is zero and why (capital return precedes profit distribution).' },
      risks: { type: 'array', items: { type: 'string' }, description: 'Up to 5 short bullets — from alerts and open items only.' },
      next_steps: { type: 'array', items: { type: 'string' }, description: 'Up to 4 short bullets.' },
    },
    required: ['title', 'headline', 'overview', 'round7', 'round8', 'returns', 'risks', 'next_steps'],
  },
} as const;

export function systemPrompt(lang: ReportLang): string {
  const language = lang === 'ar'
    ? 'Write in formal Modern Standard Arabic. Keep proper names (Stone, Bee Shipping, UME Holdings, CTM, vessel names) in Latin script. Use Western digits (0-9) for all numbers.'
    : 'Write in plain, direct business English.';
  return [
    'You write a short management report on the Stone Shipping investment held by Bee Shipping Ltd and funded by a shareholder loan from UME Holdings Ltd.',
    'You will receive FIGURES as JSON. They are the only source of truth.',
    'RULES:',
    '1. Every number you write must appear in FIGURES exactly (you may round to thousands or millions, e.g. 1,137,500 as 1.14 M). Never compute, estimate, extrapolate or invent a number, a date, a rate or a percentage.',
    '2. Do not add facts that are not in FIGURES. If something is unknown, say it is not yet confirmed.',
    '3. Distinguish clearly: "realized gain" = cash received above capital paid in; "book share of fund result" = Bee\'s pro-rata share of the fund\'s cumulative result per CTM reports (unrealized, unaudited).',
    '4. Repatriations are returns of working capital, not profit, until they exceed the capital paid in.',
    '5. All amounts are USD. Format with thousands separators.',
    '6. No signature, no greeting, no names of people. State once that these are management accounts, unaudited.',
    '7. Be concise: the whole report must fit one A4 page (about 350 words).',
    language,
  ].join('\n');
}

export function userMessage(fig: ReportFigures, lang: ReportLang, retryNote?: string): string {
  return [
    `LANGUAGE: ${lang === 'ar' ? 'Arabic' : 'English'}`,
    retryNote ? `CORRECTION REQUIRED: ${retryNote}` : '',
    'FIGURES:',
    JSON.stringify(fig, null, 1),
  ].filter(Boolean).join('\n');
}
