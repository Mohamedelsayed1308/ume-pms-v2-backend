import { money } from '../crew-salary.calc';

/**
 * ملفّات PDF في رسالة المرتّبات.
 *
 * • وثائق الهويّة والعقود (بالاسم: ID · Contract · Passport) لا يُستخرج نصّها أصلاً — لا حاجة
 *   لها في الحساب، ولا تُحفظ منها كلمة.
 * • الممسوح ضوئيّاً (بلا طبقة نصّ) يبقى للإدخال اليدويّ.
 * • المستند الماليّ المعروف يُستخرج بمصدر كلّ قيمة (الصفحة والسطر): اليوم كشف توزيع اللاشينج.
 * • ما سواه نصّاً يُعلَّم «غير معروف» — ولا يُحفظ نصّه.
 */

export type PdfKind = 'identity' | 'scanned' | 'lashing_distribution' | 'unrecognized';

export interface LashingRow {
  line: number;
  page: number;
  days: number | null;
  label: string;          // الرتبة والاسم كما في السطر
  name: string;           // الاسم بعد نزع الرتبة
  eur: string;            // النصيب باليورو
  rate: string | null;    // سعر التحويل المذكور (0 = يُصرف باليورو)
  usd: string | null;     // المقابل بالدولار
  eur_pay: string | null; // ما يُصرف باليورو
}

export interface PdfResult { kind: PdfKind; rows?: LashingRow[]; rate?: string | null; pages?: number }

export const isIdentityName = (name: string) => /^(id\b|id[\s._-])|contract|passport|seaman'?s? ?book/i.test(name.trim());

const RANK = /^(captain|master|ch\.?\s?off\.?|chief off(icer)?|\d(st|nd|rd|th)\.?\s?off\.?|bosun|bousn|a\.?\s?b\.?\s*\d*|o\.?\s?s\.?\s*\d*|m\/m|motor ?man|cook|steward)\s+/i;

/** سطر التوزيع: الأيّام، الرتبة والاسم، اليورو، السعر، الدولار، اليورو المصروف. */
const ROW = /^(\d{1,2})\s+(.+?)\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)$/;

export function parseLashingText(pages: string[]): PdfResult | null {
  const all = pages.join('\n');
  if (!/lashing bonus/i.test(all) || !/Ex\.?\s*Change rate/i.test(all)) return null;
  const rows: LashingRow[] = [];
  let rate: string | null = null;
  pages.forEach((text, pi) => {
    text.split(/\r?\n/).forEach((raw, li) => {
      const line = raw.replace(/\s+/g, ' ').trim();
      const m = ROW.exec(line);
      if (!m) return;
      const label = m[2].replace(/[,\s]+$/, '');
      if (!/[A-Za-z]{3,}/.test(label)) return;
      const r = money(m[4]);
      if (r && Number(r) > 0) rate = rate ?? r;
      rows.push({
        line: li + 1, page: pi + 1, days: Number(m[1]), label,
        name: label.replace(RANK, '').replace(/,\s*,/g, ',').trim(),
        eur: money(m[3])!, rate: r, usd: money(m[5]), eur_pay: money(m[6]),
      });
    });
  });
  return rows.length ? { kind: 'lashing_distribution', rows, rate } : null;
}

/**
 * استخراج نصّ الصفحات في عمليّةٍ فرعيّةٍ معزولة: ملفّ PDF غير موثوق لا يُحلَّل داخل الخدمة،
 * وله مهلةٌ وحدٌّ للمخرَج — فإن تعطّل أو علق لم يُسقط الخدمة.
 */
const WORKER = `
const chunks = [];
process.stdin.on('data', (c) => chunks.push(c));
process.stdin.on('end', async () => {
  const { PDFParse } = require(process.argv[1]);
  const docs = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  const out = [];
  for (const b64 of docs) {
    try {
      const p = new PDFParse({ data: new Uint8Array(Buffer.from(b64, 'base64')) });
      const r = await p.getText();
      const pages = (r.pages || []).map((x) => x.text || '');
      out.push({ pages: pages.length ? pages : [String(r.text || '')] });
      try { await p.destroy(); } catch {}
    } catch (e) { out.push({ error: true }); }
  }
  process.stdout.write(JSON.stringify(out));
});`;

/** نصوص صفحات عدّة ملفّات في عمليّةٍ واحدة — null لما تعذّرت قراءته. */
export function pdfPagesMany(bufs: Buffer[], timeoutMs = 90_000): Promise<(string[] | null)[]> {
  if (!bufs.length) return Promise.resolve([]);
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { spawn } = require('child_process') as typeof import('child_process');
  const lib = require.resolve('pdf-parse');
  return new Promise((resolve) => {
    const fail = () => resolve(bufs.map(() => null));
    const child = spawn(process.execPath, ['-e', WORKER, lib], { stdio: ['pipe', 'pipe', 'ignore'] });
    let out = '';
    const timer = setTimeout(() => { child.kill('SIGKILL'); }, timeoutMs);
    child.stdout.on('data', (d: Buffer) => { out += d.toString('utf8'); if (out.length > 20_000_000) child.kill('SIGKILL'); });
    child.on('error', () => { clearTimeout(timer); fail(); });
    child.on('close', () => {
      clearTimeout(timer);
      try {
        const arr = JSON.parse(out) as { pages?: string[]; error?: boolean }[];
        resolve(bufs.map((_, i) => (arr[i] && !arr[i].error ? arr[i].pages! : null)));
      } catch { fail(); }
    });
    child.stdin.on('error', () => undefined);
    child.stdin.end(JSON.stringify(bufs.map((b) => b.toString('base64'))));
  });
}

export function classifyPdfText(texts: string[] | null): PdfResult {
  if (!texts) return { kind: 'unrecognized' };
  const chars = texts.join('').replace(/\s|--\s*\d+\s*of\s*\d+\s*--/g, '').length;
  if (chars < 40) return { kind: 'scanned', pages: texts.length };
  return parseLashingText(texts) ?? { kind: 'unrecognized', pages: texts.length };
}

/** عدّة ملفّات: وثائق الهويّة تُصنَّف بالاسم ولا تُرسَل للاستخراج أصلاً. */
export async function parsePdfs(docs: { buf: Buffer; name: string }[]): Promise<PdfResult[]> {
  const need = docs.map((d, i) => ({ d, i })).filter(({ d }) => !isIdentityName(d.name));
  const texts = await pdfPagesMany(need.map(({ d }) => d.buf));
  const out: PdfResult[] = docs.map(() => ({ kind: 'identity' as PdfKind }));
  need.forEach(({ i }, k) => { out[i] = classifyPdfText(texts[k]); });
  return out;
}

export async function parsePdf(buf: Buffer, name: string): Promise<PdfResult> {
  return (await parsePdfs([{ buf, name }]))[0];
}
