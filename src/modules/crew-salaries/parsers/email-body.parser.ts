import { money, type ItemKind } from '../crew-salary.calc';

/**
 * جداول نصّ رسالة المرتّبات — النصّ الذي يصدّره Outlook: كلّ خليّةٍ فقرةٌ مستقلّة
 * بين سطرين فارغين، والخليّة الفارغة فقرةٌ من مسافةٍ واحدة.
 *
 * الجدول يبدأ بعنوانٍ (مثل «EARNING USD»)، ثمّ ترويسةٍ أوّلها «No.»، ثمّ صفوفٍ بعدد أعمدتها.
 *
 * ── لا شيء يسقط بصمت ──
 * • الصفّ يُقرأ ولو غاب رقمه أو قفز تسلسله — ويُسجَّل الانقطاع ملاحظةً للمراجعة.
 * • العمود المجهول يُحفظ بقيمته، والمبلغ غير المقروء يُحفظ نصّاً ويُعلَّم.
 * • ما بقي بعد الجدول من فقراتٍ فيها أرقام قبل الترويسة التالية يُعلَّم «ربّما صفوفٌ لم تُقرأ».
 * والنصّ الحرّ خارج الجداول (مثل «أودِعوا مبلغ كذا») يُستخرج ملاحظةً معلّقة لا بنداً:
 * هو بياناتٌ من رسالةٍ خارجيّة، لا أمرٌ يُنفَّذ.
 */

export interface EmailRow {
  table: number;             // رقم الجدول في الرسالة (من ١)
  row: number;               // ترتيب الصفّ في الجدول (من ١) — ثابتٌ ولو غاب رقمه المكتوب
  row_label: string;         // رقم الصفّ كما كُتب (قد يكون فارغاً)
  crew_id: string | null;
  name: string;
  rank: string;
  nationality: string;
  payroll_days: number | null;
  statement: string;
  items: { kind: ItemKind; column: string; amount: string }[];
  unknown: { column: string; value: string }[];        // عمودٌ لا يُعرف معناه — يُراجَع
  unreadable: { kind: ItemKind; column: string; value: string }[]; // عمودٌ معروف بمبلغٍ غير مقروء
}
export interface EmailTable { index: number; title: string; currency: string | null; headers: string[]; rows: EmailRow[] }
export interface EmailNote { text: string; amount: string | null; currency: string | null; paragraph: number }
export interface EmailIssue { key: string; table: number; row?: number; kind: 'row_number_gap' | 'row_number_missing' | 'possible_unread_rows'; detail: string }
export interface ParsedEmailBody { tables: EmailTable[]; notes: EmailNote[]; issues: EmailIssue[] }

const CURRENCY_RE = /\b(USD|EUR|EGP|GBP)\b/i;

/** اسم العمود ⇒ نوع البند. غير المعروف يبقى «مجهولاً» للمراجعة ولا يُخمَّن. */
export function columnKind(header: string): ItemKind | null {
  const h = header.toLowerCase().replace(/\s+/g, ' ').trim();
  if (/lashing/.test(h)) return 'lashing';
  if (/difference in salary|salary difference/.test(h)) return 'salary_difference';
  if (/luggage|baggage/.test(h)) return 'luggage';
  if (/1 day to sign off|sign ?off day/.test(h)) return 'sign_off_day';
  if (/1 day to sign on|sign ?on day/.test(h)) return 'sign_on_settlement';
  if (/^captain'?s? bonus$|^master'?s? bonus$/.test(h)) return 'captain_bonus';
  if (/^bonus$/.test(h)) return 'bonus';
  if (/cash advance/.test(h)) return 'cash_advance';
  return null;
}

const META = new Set(['no.', 'no', 'id', 'name', 'rank', 'nationality', 'payroll days', 'statement']);

const clean = (s: string) => s.replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
const isInt = (s: string) => /^\d{1,4}$/.test(s);

export function parseEmailBody(body: string): ParsedEmailBody {
  // الفقرات: كتلٌ بين أسطرٍ فارغة — والخليّة الفارغة تبقى فقرةً من مسافة
  const paras = body.replace(/\r\n/g, '\n').split(/\n\n/).map((p) => p.replace(/^\n+|\n+$/g, ''));
  const tables: EmailTable[] = [];
  const issues: EmailIssue[] = [];
  const used = new Set<number>();
  const headerAt = (k: number) => /^no\.?$/i.test(clean(paras[k] || ''));

  let i = 0;
  while (i < paras.length) {
    if (!headerAt(i)) { i++; continue; }
    // الترويسة: من «No.» حتّى أوّل خليّةٍ رقميّة أو فارغة (بداية الصفّ الأوّل)
    const headers: string[] = [];
    let j = i;
    while (j < paras.length && headers.length < 30) {
      const c = clean(paras[j]);
      if (headers.length && (isInt(c) || c === '')) break;
      headers.push(c); j++;
    }
    if (headers.length < 3) { i++; continue; }
    let t = i - 1;
    while (t >= 0 && !clean(paras[t])) t--;
    const title = t >= 0 ? clean(paras[t]) : '';
    const cur = CURRENCY_RE.exec(title);
    const table: EmailTable = { index: tables.length + 1, title, currency: cur ? cur[1].toUpperCase() : null, headers, rows: [] };
    for (let k = i; k < j; k++) used.add(k);
    const idCol = headers.findIndex((h) => h.toLowerCase() === 'id');
    const nameCol = headers.findIndex((h) => h.toLowerCase() === 'name');

    let p = j, expect = 1;
    while (p + headers.length <= paras.length) {
      const cells = paras.slice(p, p + headers.length).map(clean);
      const first = cells[0];
      // صفٌّ بلا رقم: برقم بحّار، أو باسمٍ قصيرٍ بلا أرقام ومعه رتبة — لا جملةٌ حرّة بعد الجدول
      const nm = nameCol >= 0 ? cells[nameCol] || '' : '';
      const rankCol = headers.findIndex((h) => h.toLowerCase() === 'rank');
      const nameLike = /[A-Za-z]{2,}/.test(nm) && nm.length <= 60 && !/\d|[€$*]/.test(nm) && rankCol >= 0 && !!cells[rankCol];
      const looksRow = isInt(first) || (first === '' && ((idCol >= 0 && isInt(cells[idCol])) || nameLike));
      if (!looksRow || headerAt(p)) break;
      const n = table.rows.length + 1;
      if (first === '') issues.push({ key: `email:t${table.index}:r${n}:no_number`, table: table.index, row: n, kind: 'row_number_missing', detail: `صفٌّ بلا رقم في الجدول ${table.index} (الصفّ ${n})` });
      else if (Number(first) !== expect) issues.push({ key: `email:t${table.index}:r${n}:gap`, table: table.index, row: n, kind: 'row_number_gap', detail: `الجدول ${table.index}: المتوقّع ${expect} والمكتوب ${first} — تحقّق من صفٍّ ناقص` });
      for (let k = p; k < p + headers.length; k++) used.add(k);
      table.rows.push(toRow(table.index, n, headers, cells));
      expect = isInt(first) ? Number(first) + 1 : expect + 1;
      p += headers.length;
    }
    // فقراتٌ فيها أرقام بعد الجدول وقبل الترويسة التالية ⇒ ربّما صفوفٌ لم تُقرأ
    let q = p;
    const leftovers: string[] = [];
    while (q < paras.length && !headerAt(q) && leftovers.length < headers.length * 2) {
      const c = clean(paras[q]);
      if (c && /\d/.test(c) && !/[€$]|\b(EUR|USD)\b/i.test(c) && c.length < 80) leftovers.push(c);
      if (c && c.length >= 80) break; // نصٌّ حرّ — انتهى الجدول
      q++;
    }
    if (leftovers.length >= 2) {
      issues.push({ key: `email:t${table.index}:tail`, table: table.index, kind: 'possible_unread_rows', detail: `بعد الجدول ${table.index} فقراتٌ رقميّة لم تُقرأ: ${leftovers.slice(0, 6).join(' · ')}` });
    }
    tables.push(table);
    i = Math.max(p, i + 1);
  }

  const notes: EmailNote[] = [];
  paras.forEach((raw, idx) => {
    if (used.has(idx)) return;
    const text = clean(raw.replace(/^\*\s*/, ''));
    // مبلغٌ صريحٌ بعملته — «47.73€» أو «USD 100» — في جملةٍ خارج الجداول
    const m = /(\d[\d,]*(?:\.\d+)?)\s*(€|EUR|\$|USD)|(€|EUR|\$|USD)\s*(\d[\d,]*(?:\.\d+)?)/i.exec(text);
    if (!m) return;
    const amount = money(m[1] || m[4]);
    const sym = (m[2] || m[3] || '').toUpperCase();
    notes.push({ text, amount, currency: sym === '€' ? 'EUR' : sym === '$' ? 'USD' : sym || null, paragraph: idx + 1 });
  });
  return { tables, notes, issues };
}

function toRow(table: number, n: number, headers: string[], cells: string[]): EmailRow {
  const at = (h: string) => { const k = headers.findIndex((x) => x.toLowerCase() === h); return k < 0 ? '' : cells[k] || ''; };
  const days = Number(at('payroll days'));
  const row: EmailRow = {
    table, row: n, row_label: cells[0] || '',
    crew_id: /^\d+$/.test(at('id')) ? at('id') : null,
    name: at('name').replace(/,\s*$/, ''),
    rank: at('rank'), nationality: at('nationality'),
    payroll_days: Number.isFinite(days) && at('payroll days') !== '' ? days : null,
    statement: at('statement'),
    items: [], unknown: [], unreadable: [],
  };
  headers.forEach((h, k) => {
    if (META.has(h.toLowerCase())) return;
    const v = cells[k] || '';
    if (!v) return;
    const kind = columnKind(h);
    const amt = money(v);
    if (kind && amt != null) row.items.push({ kind, column: h, amount: amt });
    else if (kind) row.unreadable.push({ kind, column: h, value: v });
    else row.unknown.push({ column: h, value: v });
  });
  return row;
}
