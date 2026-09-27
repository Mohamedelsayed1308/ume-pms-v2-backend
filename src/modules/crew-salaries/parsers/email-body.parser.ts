import { money, type ItemKind } from '../crew-salary.calc';

/**
 * جداول نصّ رسالة المرتّبات — النصّ الذي يصدّره Outlook: كلّ خليّةٍ فقرةٌ مستقلّة
 * بين سطرين فارغين، والخليّة الفارغة فقرةٌ من مسافةٍ واحدة.
 *
 * الجدول يبدأ بعنوانٍ (مثل «EARNING USD»)، ثمّ ترويسةٍ أوّلها «No.»، ثمّ صفوفٍ
 * أوّل خليّةٍ فيها رقم الصفّ متسلسلاً. ويتوقّف الجدول عند أوّل خروجٍ عن التسلسل.
 *
 * والنصّ الحرّ خارج الجداول (مثل «أودِعوا مبلغ كذا في حساب القبطان») يُستخرج
 * **اقتراحاً معلّقاً** لا بنداً: هو بياناتٌ من رسالةٍ خارجيّة، لا أمرٌ يُنفَّذ.
 */

export interface EmailCell { value: string; column: string }
export interface EmailRow {
  table: number;             // رقم الجدول في الرسالة (من ١)
  row: number;               // رقم الصفّ كما في الرسالة
  crew_id: string | null;
  name: string;
  rank: string;
  nationality: string;
  payroll_days: number | null;
  statement: string;
  items: { kind: ItemKind; column: string; amount: string }[];
  unknown: { column: string; value: string }[];
}
export interface EmailTable { index: number; title: string; currency: string | null; headers: string[]; rows: EmailRow[] }
export interface EmailNote { text: string; amount: string | null; currency: string | null; paragraph: number }
export interface ParsedEmailBody { tables: EmailTable[]; notes: EmailNote[] }

const CURRENCY_RE = /\b(USD|EUR|EGP|GBP)\b/i;

/** اسم العمود ⇒ نوع البند. غير المعروف يبقى «مجهولاً» للمراجعة ولا يُخمَّن. */
export function columnKind(header: string): ItemKind | null {
  const h = header.toLowerCase().replace(/\s+/g, ' ').trim();
  if (/lashing/.test(h)) return 'lashing';
  if (/difference in salary|salary difference/.test(h)) return 'salary_difference';
  if (/luggage|baggage/.test(h)) return 'luggage';
  if (/1 day to sign off|sign ?off day/.test(h)) return 'sign_off_day';
  if (/1 day to sign on|sign ?on day/.test(h)) return 'sign_on_settlement';
  if (/^bonus$/.test(h)) return 'bonus';
  if (/cash advance/.test(h)) return 'cash_advance';
  return null;
}

const META = new Set(['no.', 'id', 'name', 'rank', 'nationality', 'payroll days', 'statement']);

const clean = (s: string) => s.replace(/ /g, ' ').replace(/\s+/g, ' ').trim();

export function parseEmailBody(body: string): ParsedEmailBody {
  // الفقرات: كتلٌ بين أسطرٍ فارغة — والخليّة الفارغة تبقى فقرةً من مسافة
  const paras = body.replace(/\r\n/g, '\n').split(/\n\n/).map((p) => p.replace(/^\n+|\n+$/g, ''));
  const tables: EmailTable[] = [];
  const used = new Set<number>();
  let i = 0;
  while (i < paras.length) {
    if (clean(paras[i]) !== 'No.') { i++; continue; }
    // الترويسة حتّى أوّل «1»
    const headers: string[] = [];
    let j = i;
    while (j < paras.length && clean(paras[j]) !== '1' && headers.length < 30) { headers.push(clean(paras[j])); j++; }
    if (clean(paras[j] || '') !== '1' || headers.length < 3) { i++; continue; }
    // العنوان: آخر فقرةٍ غير فارغةٍ قبل الترويسة
    let t = i - 1;
    while (t >= 0 && !clean(paras[t])) t--;
    const title = t >= 0 ? clean(paras[t]) : '';
    const cur = CURRENCY_RE.exec(title);
    const table: EmailTable = { index: tables.length + 1, title, currency: cur ? cur[1].toUpperCase() : null, headers, rows: [] };
    for (let k = i; k < j; k++) used.add(k);
    let expect = 1;
    let p = j;
    while (p + headers.length <= paras.length && clean(paras[p]) === String(expect)) {
      const cells = paras.slice(p, p + headers.length).map(clean);
      for (let k = p; k < p + headers.length; k++) used.add(k);
      table.rows.push(toRow(table.index, headers, cells));
      p += headers.length; expect++;
    }
    tables.push(table);
    i = p;
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
  return { tables, notes };
}

function toRow(table: number, headers: string[], cells: string[]): EmailRow {
  const at = (h: string) => { const k = headers.findIndex((x) => x.toLowerCase() === h); return k < 0 ? '' : cells[k] || ''; };
  const days = Number(at('payroll days'));
  const row: EmailRow = {
    table, row: Number(cells[0]),
    crew_id: /^\d+$/.test(at('id')) ? at('id') : null,
    name: at('name').replace(/,\s*$/, ''),
    rank: at('rank'), nationality: at('nationality'),
    payroll_days: Number.isFinite(days) && at('payroll days') !== '' ? days : null,
    statement: at('statement'),
    items: [], unknown: [],
  };
  headers.forEach((h, k) => {
    if (META.has(h.toLowerCase())) return;
    const v = cells[k] || '';
    if (!v) return;
    const kind = columnKind(h);
    const amt = money(v);
    if (kind && amt != null) row.items.push({ kind, column: h, amount: amt });
    else row.unknown.push({ column: h, value: v });
  });
  return row;
}
