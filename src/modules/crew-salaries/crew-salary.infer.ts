import { parseMonthName } from './parsers/cfm.parser';

/**
 * استنتاج المركب والشهر من المحتوى — لا من اسم الملفّ ولا من تاريخ التصدير
 * (تصدير CFM قد يحمل تاريخاً غير شهر المرتّبات). وكلّ استنتاجٍ يُعرض ويُصحَّح.
 */

export interface Inference { vessel: string | null; month: string | null; evidence: string[]; conflicts: string[] }

/** «GUBAL TRADER» و«04. Gubal Trader» و«Gubal Trader» ⇒ «Gubal Trader». */
export function normalizeVessel(s: string | null | undefined): string | null {
  if (!s) return null;
  const v = s.replace(/^\s*\d+\s*[.)-]\s*/, '').replace(/^(M\.?\s*V\.?|Ro\/Pax|MV)\s*[:/]?\s*/i, '').replace(/\s+/g, ' ').trim();
  if (!v || v.length > 60) return null;
  return v.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

/** «Salary of Aug. 2026» ⇒ 2026-08. */
export function monthFromText(s: string): string | null {
  const m = /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?\s*,?\s*(\d{4})\b/i.exec(s || '');
  return m ? parseMonthName(`${m[1]} ${m[2]}`) : null;
}

export function vesselFromBody(body: string): string | null {
  const m = /M\.?\s*V\.?\s*\/\s*([A-Za-z][A-Za-z .'-]{2,40}?)\s+crew/i.exec(body || '');
  return m ? normalizeVessel(m[1]) : null;
}

export function combine(votes: { vessel?: string | null; month?: string | null; source: string }[]): Inference {
  const out: Inference = { vessel: null, month: null, evidence: [], conflicts: [] };
  const pick = (field: 'vessel' | 'month') => {
    const seen = new Map<string, string[]>();
    for (const v of votes) {
      const x = v[field];
      if (!x) continue;
      const k = x.toLowerCase();
      seen.set(k, [...(seen.get(k) || []), v.source]);
      out.evidence.push(`${field === 'vessel' ? 'المركب' : 'الشهر'} «${x}» من ${v.source}`);
    }
    if (seen.size > 1) out.conflicts.push(`${field === 'vessel' ? 'المركب' : 'الشهر'}: ${[...seen.keys()].join(' ≠ ')}`);
    if (seen.size === 1) {
      const k = [...seen.keys()][0];
      return votes.find((v) => v[field]?.toLowerCase() === k)![field]!;
    }
    return null;
  };
  out.vessel = pick('vessel');
  out.month = pick('month');
  return out;
}
