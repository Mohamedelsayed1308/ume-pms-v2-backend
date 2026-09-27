import MsgReader from '@kenjiuno/msgreader';
import { createHash } from 'crypto';

/**
 * قراءة رسالة Outlook (`.msg`) كما هي — النصّ والمرفقات، بلا تنفيذ أيّ شيء.
 *
 * ── الأمان ──
 * محتوى الرسالة ومرفقاتها **بياناتٌ غير موثوقة**: لا يُتبع رابط، ولا يُفتح مرفقٌ برنامجاً،
 * ولا يُنفّذ ماكرو، ولا يُعامل نصٌّ فيها تعليمةً للنظام. والرسالة المضمّنة داخل رسالة
 * تُسجَّل مرفقاً غير مدعوم ولا تُفكّ.
 * ولا يُطبع شيءٌ من المحتوى في السجلّات.
 */

export type AttachmentClass =
  | 'spreadsheet'        // xlsx — يُستخرج
  | 'spreadsheet_macro'  // xlsm/xlsb/xls بماكرو — يُرفض استخراجه
  | 'pdf'                // يُفحص للطبقة النصّيّة
  | 'image'              // إدخالٌ يدويّ
  | 'inline_image'       // صورة توقيعٍ مضمّنة — تُتجاهل
  | 'unsupported';

export interface MsgAttachment {
  index: number;             // موضعه في الرسالة — جزءٌ من المصدر
  name: string;
  ext: string;
  size: number;
  mime: string | null;
  sha256: string;
  class: AttachmentClass;
  content: Buffer;
}

export interface ParsedMsg {
  subject: string;
  from: string;
  sent_at: string | null;    // ISO
  body: string;
  attachments: MsgAttachment[];
}

const MACRO_EXT = new Set(['.xlsm', '.xlsb', '.xltm', '.xla', '.xlam', '.xls']);
const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.tif', '.tiff', '.heic', '.webp']);

export function classifyAttachment(name: string, hidden: boolean, content: Buffer): AttachmentClass {
  const ext = extOf(name);
  if (IMAGE_EXT.has(ext)) return hidden ? 'inline_image' : 'image';
  if (ext === '.pdf') return 'pdf';
  if (ext === '.xlsx') return hasVbaProject(content) ? 'spreadsheet_macro' : 'spreadsheet';
  if (MACRO_EXT.has(ext)) return 'spreadsheet_macro';
  return 'unsupported';
}

export const extOf = (name: string) => {
  const m = /\.[A-Za-z0-9]+$/.exec(name || '');
  return m ? m[0].toLowerCase() : '';
};

/** xlsx مُعاد التسمية وفيه مشروع VBA — يُكشف من اسم الجزء داخل الأرشيف. */
export function hasVbaProject(buf: Buffer): boolean {
  return buf.includes(Buffer.from('xl/vbaProject.bin')) || buf.includes(Buffer.from('vbaProject.bin'));
}

export const sha256 = (buf: Buffer) => createHash('sha256').update(buf).digest('hex');

function isoDate(s: unknown): string | null {
  if (typeof s !== 'string' || !s.trim()) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function parseMsg(buf: Buffer): ParsedMsg {
  const reader = new MsgReader(new DataView(buf.buffer, buf.byteOffset, buf.byteLength));
  const data: any = reader.getFileData();
  if (!data || data.error) throw new Error('ملفّ الرسالة غير صالح أو تالف');
  const attachments: MsgAttachment[] = [];
  (data.attachments || []).forEach((a: any, index: number) => {
    const name = String(a.fileName || a.fileNameShort || a.name || `attachment-${index + 1}`);
    if (a.innerMsgContent) {
      attachments.push({ index, name, ext: '.msg', size: 0, mime: null, sha256: '', class: 'unsupported', content: Buffer.alloc(0) });
      return;
    }
    const att: any = reader.getAttachment(a);
    const content = Buffer.from(att?.content || []);
    attachments.push({
      index, name, ext: extOf(name), size: content.length,
      mime: a.attachMimeTag || null, sha256: sha256(content),
      class: classifyAttachment(name, !!a.attachmentHidden, content),
      content,
    });
  });
  return {
    subject: String(data.subject || ''),
    from: String(data.senderSmtpAddress || data.senderEmail || ''),
    sent_at: isoDate(data.clientSubmitTime) || isoDate(data.messageDeliveryTime),
    body: String(data.body || ''),
    attachments,
  };
}

/**
 * هل في الـPDF طبقةٌ نصّيّة؟ فحصٌ بنيويّ رخيص: خطوطٌ وعوامل نصّ.
 * الممسوح ضوئيّاً صورٌ بلا خطوط ⇒ إدخالٌ يدويّ. ولا يُستخرج النصّ هنا.
 */
export function pdfHasTextLayer(buf: Buffer): boolean {
  if (!buf.subarray(0, 1024).toString('latin1').includes('%PDF')) return false;
  const s = buf.toString('latin1');
  return /\/Font\b/.test(s) && /\/Type\s*\/Font/.test(s);
}

/** أيّ محتوى نشط في الـPDF (JavaScript أو إجراءٌ تلقائيّ أو ملفٌّ مضمّن) — يُعلَّم ولا يُفتح. */
export function pdfActiveContent(buf: Buffer): string[] {
  const s = buf.toString('latin1');
  const flags: string[] = [];
  if (/\/JavaScript\b|\/JS\b/.test(s)) flags.push('javascript');
  if (/\/OpenAction\b|\/AA\b/.test(s)) flags.push('auto_action');
  if (/\/EmbeddedFile\b/.test(s)) flags.push('embedded_file');
  if (/\/Launch\b/.test(s)) flags.push('launch');
  return flags;
}
