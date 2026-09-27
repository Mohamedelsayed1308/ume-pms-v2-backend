/**
 * مطابقة الأسماء بأرقام البحّارة — اقتراحٌ لا قرار.
 *
 * رقم البحّار (Crew ID) هو المفتاح الوحيد الموثوق. وحيث يغيب (كشف الصرف وكشف البنوك)
 * تُقترح المطابقة بالاسم والرتبة:
 *   • «exact»: مجموعة كلمات الاسم مطابقةٌ تماماً (بأيّ ترتيب) لمرشّحٍ **واحدٍ فقط**.
 *   • «suggested»: تطابقٌ جزئيّ أو أكثر من مرشّح — لا يُعتمد حتّى يؤكّده إنسان.
 *   • «none»: لا مرشّح.
 * والربط المؤكَّد يُحفظ ويُعاد استعماله في الأشهر التالية.
 */

export interface Candidate { crew_id: string; names: string[]; rank?: string }
export interface MatchResult {
  status: 'confirmed' | 'exact' | 'suggested' | 'none';
  crew_id: string | null;
  score: number;
  candidates: { crew_id: string; score: number }[];
}

const ALIAS: Record<string, string> = { ADL: 'ADEL', ABDELFATTH: 'ABDELFATTAH', REFAAT: 'REFAT', MOSTAPHA: 'MOSTAFA', MOUSTAPHA: 'MOSTAFA' };

export function nameTokens(name: string): string[] {
  return name
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .toUpperCase().replace(/[^A-Z؀-ۿ ]+/g, ' ')
    .split(/\s+/).filter((t) => t.length > 1)
    .map((t) => ALIAS[t] || t);
}

/** مفتاح المصدر لربطٍ محفوظ: الكلمات مرتّبةً — لا يتأثّر بترتيب الاسم ولا بالفواصل. */
export const sourceKey = (name: string) => [...new Set(nameTokens(name))].sort().join(' ');

function score(a: string[], b: string[]): number {
  const A = new Set(a), B = new Set(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  // نسبة التغطية من الأقصر — «أحمد رفعت إبراهيم سليمان» داخل الاسم الكامل
  return inter / Math.min(A.size, B.size) * (inter / Math.max(A.size, B.size)) ** 0.25;
}

const setEq = (a: string[], b: string[]) => {
  const A = new Set(a), B = new Set(b);
  return A.size === B.size && [...A].every((t) => B.has(t));
};

export function matchName(name: string, candidates: Candidate[], confirmed?: Map<string, string>): MatchResult {
  const key = sourceKey(name);
  const saved = confirmed?.get(key);
  if (saved && candidates.some((c) => c.crew_id === saved)) {
    return { status: 'confirmed', crew_id: saved, score: 1, candidates: [{ crew_id: saved, score: 1 }] };
  }
  const t = nameTokens(name);
  const exact = candidates.filter((c) => c.names.some((n) => setEq(nameTokens(n), t)));
  const scored = candidates
    .map((c) => ({ crew_id: c.crew_id, score: Math.max(...c.names.map((n) => score(nameTokens(n), t))) }))
    .filter((c) => c.score >= 0.5)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map((c) => ({ ...c, score: Math.round(c.score * 100) / 100 }));
  if (exact.length === 1) return { status: 'exact', crew_id: exact[0].crew_id, score: 1, candidates: scored };
  if (!scored.length) return { status: 'none', crew_id: null, score: 0, candidates: [] };
  return { status: 'suggested', crew_id: null, score: scored[0].score, candidates: scored };
}
