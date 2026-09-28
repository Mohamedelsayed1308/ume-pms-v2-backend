import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { createHash, randomUUID } from 'crypto';
import Decimal from 'decimal.js';
import { DataSource, EntityManager, In, IsNull, Not } from 'typeorm';
import { ExchangeRatesService } from '../exchange-rates/exchange-rates.service';
import { ScreenAuthzService } from '../../common/screen-authz.service';
import { approverId, isApprover } from './crew-salary.approver';
import { assemble, recompute, type AssembledEntry, type Resolution, type Sources, type SupplementaryInput } from './crew-salary.assemble';
import { crossRate, isMoney, monthBounds, rateLabel, RATE_KINDS, type ExtraItemInput, type FxMonth, type ItemKind } from './crew-salary.calc';
import {
  CrewSalaryAudit, CrewSalaryAuthorization, CrewSalaryBankAccount, CrewSalaryCycle, CrewSalaryDecision,
  CrewSalaryEntitlement, CrewSalaryExport, CrewSalaryExportRow, CrewSalaryFile, CrewSalaryLink, CrewSalaryVersion,
} from './crew-salary.entity';
import { buildPaymentsWorkbook, buildReviewWorkbook, emptyContext, payableEntries, type PaymentContext, type Snapshot, type SnapshotBank, type SnapshotEntry } from './crew-salary.export';
import { combine, monthFromText, normalizeVessel, vesselFromBody } from './crew-salary.infer';
import { sourceKey } from './crew-salary.match';
import { parseAttachmentWorkbook, type AttachmentSheet } from './parsers/attachments.parser';
import { isCfmWorkbook, parseCfm, readWorkbook, type CfmExport } from './parsers/cfm.parser';
import { parseEmailBody, type ParsedEmailBody } from './parsers/email-body.parser';
import { extOf, hasVbaProject, parseMsg, pdfActiveContent, sha256 } from './parsers/msg.parser';
import { parsePdfs, type LashingRow } from './parsers/pdf.parser';

/**
 * مرتّبات أطقم السفن — سير العمل على القاعدة.
 *
 * الاستيراد ⇐ الاستخراج ⇐ المراجعة (قراراتٌ تُستبدل ولا تُمحى) ⇐ التقديم (لقطةٌ مجمّدة للحالات
 * المكتملة المختارة) ⇐ الاعتماد (المعتمد الوحيد، والاستحقاقات بفهرسٍ فريد) ⇐ التصدير (ليس سداداً).
 *
 * ── التزامن ──
 * أقفالٌ استشاريّة داخل المعاملة، تُؤخذ دائماً بترتيبٍ ثابت: `crew:<id>` و`cycle:<id>` و`fx:<month>`.
 * كلّ كتابةٍ تمسّ دورةً تقفلها، وكلّ كتابةٍ على حسابٍ أو تفويض تقفل البحّار، وسعر الشهر يقفل الشهر.
 * والاعتماد يقفل الثلاثة معاً ثمّ يعيد التحقّق — فلا يمرّ تعديلٌ بين التحقّق والاعتماد.
 *
 * لا يُطبع في السجلّات شيءٌ من محتوى الملفّات ولا بيانات البنوك.
 */

export interface Actor { id: string; email?: string; full_name?: string; role?: string }

export const SCREEN = '/dashboard/fleet-crew-salaries';
/** تعديل أسعار الشركة المشتركة صلاحيةٌ قائمة: شاشة التقارير — لا شاشة المرتّبات. */
export const FX_EDIT_SCREEN = '/dashboard/reports';
export const DECISION_KINDS = ['item_review', 'field_override', 'manual_item', 'difference_ack', 'item_classify', 'item_currency', 'resolve', 'supplementary', 'payment_currency', 'batch_resolution'] as const;
type DecisionKind = (typeof DECISION_KINDS)[number];
const OVERRIDE_FIELDS = ['pay_start', 'pay_end', 'basic', 'fixed_ot', 'leave', 'signs_off'] as const;
const MANUAL_KINDS: ItemKind[] = ['sign_on_settlement', 'lashing', 'captain_bonus', 'bonus', 'salary_difference', 'luggage', 'other_earning', 'cash_advance', 'other_deduction'];
const MAX_FILE = 30 * 1024 * 1024;

/** JSON بترتيب مفاتيح ثابت — بصمة اللقطة لا تتأثّر بترتيب الإدراج. */
export function stableStringify(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v as object).sort().filter((k) => (v as any)[k] !== undefined).map((k) => `${JSON.stringify(k)}:${stableStringify((v as any)[k])}`).join(',')}}`;
  }
  return JSON.stringify(v ?? null);
}
export const hashOf = (v: unknown) => createHash('sha256').update(stableStringify(v)).digest('hex');
const nameOf = (a: Actor) => (a.full_name || a.email || '').slice(0, 150);
const need = (reason: unknown, what = 'السبب') => {
  const r = String(reason ?? '').trim();
  if (r.length < 3) throw new BadRequestException(`${what} مطلوبٌ (ثلاثة أحرفٍ على الأقلّ)`);
  return r.slice(0, 2000);
};
const vesselSlug = (v: string) => v.toUpperCase().replace(/[^A-Z0-9]+/g, '').slice(0, 12) || 'VESSEL';
/** «true»/«false» نصّاً أو منطقيّاً — وما سواهما مرفوض (لا تحويل «false» إلى صحيح). */
export function parseBool(v: unknown): boolean | null {
  if (v === true || v === 'true') return true;
  if (v === false || v === 'false') return false;
  return null;
}

type Approval = { version_id: string; version_no: number; entry_hash: string; balance: string };
export interface EntryState extends SnapshotEntry {
  entry_hash: string;
  approval: (Approval & { changed: boolean }) | null;
  eligible: boolean;                   // مكتملة ومُقَرّة وليست معتمدةً بلا تغيير
}

@Injectable()
export class CrewSalariesService {
  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    private readonly fx: ExchangeRatesService,
    private readonly authz: ScreenAuthzService,
  ) {}

  // ══════════════════════════ الأقفال والتدقيق ══════════════════════════
  /** أقفالٌ استشاريّة بترتيبٍ ثابت داخل المعاملة — تُحرَّر عند انتهائها. */
  private async lock(m: EntityManager, keys: string[]) {
    for (const k of [...new Set(keys)].sort()) await m.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`crew_salary:${k}`]);
  }

  private async audit(m: EntityManager, a: Actor, action: string, entity: string, entityId: string, cycleId: string | null, reason = '', details: Record<string, any> = {}) {
    await m.getRepository(CrewSalaryAudit).insert({
      cycle_id: cycleId, entity, entity_id: String(entityId || ''), action,
      user_id: a.id || null, user_email: (a.email || '').slice(0, 255), user_name: nameOf(a), reason, details: details as any,
    });
  }

  async permissions(a: Actor) {
    return {
      approver_configured: !!approverId(), can_approve: isApprover(a.id),
      can_edit_fx: a.id ? await this.authz.can(a.id, FX_EDIT_SCREEN) : false,
    };
  }

  private assertApprover(a: Actor) {
    if (!approverId()) throw new ForbiddenException('لم يُعيَّن صاحب صلاحية الاعتماد بعد — الاعتماد مرفوضٌ حتّى تأكيد الحساب');
    if (!isApprover(a.id)) throw new ForbiddenException('الاعتماد لصاحب الصلاحية المعيَّن وحده');
  }

  // ══════════════════════════ الاستيراد ══════════════════════════
  async importFile(buf: Buffer, originalName: string, a: Actor, opts: { replaces?: string; reason?: string } = {}) {
    if (!buf?.length) throw new BadRequestException('الملفّ فارغ');
    if (buf.length > MAX_FILE) throw new BadRequestException('الملفّ أكبر من الحدّ المسموح (30MB)');
    const name = String(originalName || 'file').slice(0, 255);
    const ext = extOf(name);
    if (ext !== '.msg' && ext !== '.xlsx') throw new BadRequestException('المقبول: رسالة Outlook ‎.msg أو ملفّ Excel ‎.xlsx (بلا ماكرو)');
    // الفحص نفسه المطبَّق على المرفقات: xlsx مُعاد التسمية بمشروع VBA يُرفض ولا يُخزَّن
    if (ext === '.xlsx' && hasVbaProject(buf)) throw new BadRequestException('الملفّ يحوي ماكرو (VBA) — مرفوض');
    const sha = sha256(buf);
    const files = this.ds.getRepository(CrewSalaryFile);
    const dup = await files.findOne({ where: { sha256: sha, parent_id: IsNull() } });
    if (dup) {
      await this.ds.transaction((m) => this.audit(m, a, 'import_duplicate', 'file', dup.id, dup.cycle_id, '', { name }));
      return { duplicate: true, file: dup, cycle_id: dup.cycle_id, message: 'هذا الملفّ نفسه مستورَدٌ من قبل — لم يُخزَّن مرّةً ثانية' };
    }

    // ── الاستخراج قبل أيّ كتابة ──
    type Child = Partial<CrewSalaryFile> & { content: Buffer };
    const children: Child[] = [];
    let kind: string, cls: string, parsed: any, meta: Record<string, unknown> = {};
    const votes: { vessel?: string | null; month?: string | null; source: string }[] = [];
    const flags: string[] = [];

    if (ext === '.msg') {
      let msg;
      try { msg = parseMsg(buf); } catch { throw new BadRequestException('تعذّر قراءة الرسالة — الملفّ تالفٌ أو ليس رسالة Outlook'); }
      kind = 'email'; cls = 'email';
      const body: ParsedEmailBody = parseEmailBody(msg.body);
      parsed = { kind: 'email', body };
      meta = { subject: msg.subject.slice(0, 300), from: msg.from.slice(0, 200), sent_at: msg.sent_at, tables: body.tables.length, rows: body.tables.reduce((n, t) => n + t.rows.length, 0), notes: body.notes.length, issues: body.issues.length };
      votes.push({ month: monthFromText(msg.subject), source: 'موضوع الرسالة' });
      votes.push({ vessel: vesselFromBody(msg.body), source: 'نصّ الرسالة' });
      const pdfs = msg.attachments.filter((x) => x.class === 'pdf');
      const pdfResults = new Map((await parsePdfs(pdfs.map((x) => ({ buf: x.content, name: x.name })))).map((r, i) => [pdfs[i].index, r]));
      for (const at of msg.attachments) {
        const c: Child = { position: at.index, name: at.name.slice(0, 255), ext: at.ext.slice(0, 12), mime: at.mime, size: at.size, sha256: at.sha256 || sha256(at.content), class: at.class, content: at.content, kind: 'attachment', flags: [], meta: {} };
        if (at.class === 'spreadsheet') {
          try {
            const wb = readWorkbook(at.content);
            if (isCfmWorkbook(wb)) {
              const x = parseCfm(at.content, at.name);
              c.parsed = { kind: 'cfm', data: x }; c.status = 'extracted';
              c.meta = { cfm_currency: x.currency, rows: x.rows.length, month: x.month, vessel: x.vessel };
              votes.push({ month: x.month, vessel: normalizeVessel(x.vessel), source: `تصدير CFM «${at.name}»` });
            } else {
              const s = parseAttachmentWorkbook(at.content, at.name);
              c.parsed = s;
              c.status = s.kind === 'unknown' ? 'needs_manual' : s.kind === 'lashing_activity' ? 'stored' : 'extracted';
              c.meta = { sheet_kind: s.kind, rows: 'rows' in s ? s.rows.length : 0 };
              if (s.kind === 'payout') votes.push({ vessel: normalizeVessel(s.vessel), source: `كشف الصرف «${at.name}»` });
              if (s.kind === 'crew_list') votes.push({ vessel: normalizeVessel(s.vessel), source: `قائمة الطاقم «${at.name}»` });
              if (s.kind === 'unknown') c.flags = ['unrecognized_sheet'];
              if (s.kind === 'lashing_activity') c.flags = ['reference_only'];
            }
          } catch {
            c.status = 'needs_manual'; c.flags = ['unreadable'];
          }
        } else if (at.class === 'pdf') {
          const active = pdfActiveContent(at.content).map((x) => `active_${x}`);
          {
            const r = pdfResults.get(at.index) || { kind: 'unrecognized' as const };
            if (r.kind === 'identity') { c.status = 'stored'; c.flags = ['identity_document', ...active]; }
            else if (r.kind === 'scanned') { c.status = 'needs_manual'; c.flags = ['pdf_scanned', ...active]; }
            else if (r.kind === 'lashing_distribution') { c.status = 'extracted'; c.flags = active; c.parsed = { kind: 'lashing_distribution', rows: r.rows, rate: r.rate }; c.meta = { pdf_kind: r.kind, rows: r.rows?.length ?? 0, rate: r.rate }; }
            else { c.status = 'needs_manual'; c.flags = ['pdf_text_unrecognized', ...active]; }
          }
        } else if (at.class === 'image') { c.status = 'needs_manual'; c.flags = ['image_manual_entry']; }
        else if (at.class === 'inline_image') { c.status = 'ignored'; c.flags = ['inline_signature']; c.content = Buffer.alloc(0); }
        else if (at.class === 'spreadsheet_macro') { c.status = 'rejected'; c.flags = ['macro_rejected']; c.content = Buffer.alloc(0); }
        else { c.status = 'rejected'; c.flags = ['unsupported']; c.content = Buffer.alloc(0); }
        children.push(c);
      }
    } else {
      cls = 'spreadsheet';
      let wb;
      try { wb = readWorkbook(buf); } catch { throw new BadRequestException('تعذّر قراءة ملفّ Excel'); }
      if (isCfmWorkbook(wb)) {
        const x = parseCfm(buf, name);
        kind = 'cfm'; parsed = { kind: 'cfm', data: x };
        meta = { cfm_currency: x.currency, rows: x.rows.length, month: x.month, vessel: x.vessel, warnings: x.warnings };
        votes.push({ month: x.month, vessel: normalizeVessel(x.vessel), source: 'ورقة الملخّص في CFM' });
      } else {
        const s = parseAttachmentWorkbook(buf, name);
        if (s.kind === 'unknown') throw new BadRequestException('لم يُتعرَّف على الملفّ: ليس تصدير CFM ولا كشف صرفٍ ولا كشف بنوكٍ ولا قائمة طاقم');
        kind = 'attachment'; parsed = s;
        meta = { sheet_kind: s.kind, rows: 'rows' in s ? s.rows.length : 0 };
        if (s.kind === 'payout' || s.kind === 'crew_list') votes.push({ vessel: normalizeVessel(s.vessel), source: name });
      }
    }

    const inf = combine(votes);
    meta.inference = inf;
    if (inf.conflicts.length) flags.push('inference_conflict');

    return this.ds.transaction(async (m) => {
      let cycle: CrewSalaryCycle | null = null;
      if (inf.vessel && inf.month && !inf.conflicts.length) cycle = await this.findOrCreateCycle(m, inf.vessel, inf.month, a);
      let supersedes: CrewSalaryFile | null = null;
      if (opts.replaces) {
        supersedes = await m.getRepository(CrewSalaryFile).findOne({ where: { id: opts.replaces } });
        if (!supersedes) throw new BadRequestException('الملفّ المُستبدَل غير موجود');
        // تصديرٌ مصحَّح يحلّ محلّ تصديرٍ مرفقٍ داخل رسالة — أو محلّ ملفٍّ مستقلٍّ من نوعه
        const oldKind = supersedes.parent_id ? (supersedes.meta?.cfm_currency ? 'cfm' : supersedes.kind) : supersedes.kind;
        if (oldKind !== kind) throw new BadRequestException('النسخة المصحَّحة يجب أن تكون من نوع الملفّ الأصليّ نفسه');
        need(opts.reason, 'سبب الاستبدال');
      }
      const cycleId = cycle?.id ?? supersedes?.cycle_id ?? null;
      if (cycleId) await this.lock(m, [`cycle:${cycleId}`]);
      const saved = await m.getRepository(CrewSalaryFile).save(m.getRepository(CrewSalaryFile).create({
        cycle_id: cycleId, kind, name, ext, mime: null, size: buf.length, sha256: sha,
        content: buf, class: cls, status: 'extracted', flags, meta, parsed, supersedes_id: supersedes?.id ?? null, uploaded_by: a.id || null,
      }));
      for (const c of children) {
        await m.getRepository(CrewSalaryFile).insert({
          cycle_id: saved.cycle_id, parent_id: saved.id, position: c.position ?? null, kind: 'attachment', name: c.name!, ext: c.ext || '',
          mime: c.mime ?? null, size: c.size || 0, sha256: c.sha256 || '', content: c.content, class: c.class || 'unsupported',
          status: c.status || 'stored', flags: c.flags || [], meta: c.meta || {}, parsed: c.parsed ?? null, uploaded_by: a.id || null,
        });
      }
      if (supersedes) {
        await m.getRepository(CrewSalaryFile).update({ id: supersedes.id }, { status: 'superseded' });
        if (!supersedes.parent_id) await m.getRepository(CrewSalaryFile).update({ parent_id: supersedes.id }, { status: 'superseded' });
      }
      // تصدير CFM جديدٌ بالعملة نفسها يحلّ محلّ السابق في الدورة — مستقلّاً كان أو مرفقاً في رسالة
      const newCfm = kind === 'cfm' ? [meta.cfm_currency] : children.filter((c) => c.meta?.cfm_currency).map((c) => c.meta!.cfm_currency);
      if (saved.cycle_id && newCfm.length) {
        const prev = await m.getRepository(CrewSalaryFile).createQueryBuilder('f')
          .where('f.cycle_id = :c', { c: saved.cycle_id }).andWhere("f.status <> 'superseded'")
          .andWhere("(f.meta->>'cfm_currency') IS NOT NULL").andWhere('f.id <> :id', { id: saved.id })
          .andWhere('(f.parent_id IS NULL OR f.parent_id <> :id)', { id: saved.id }).getMany();
        for (const p of prev.filter((p) => newCfm.includes(p.meta?.cfm_currency))) {
          await m.getRepository(CrewSalaryFile).update({ id: p.id }, { status: 'superseded' });
          await this.audit(m, a, 'file_superseded', 'file', p.id, saved.cycle_id, 'تصدير CFM أحدث بالعملة نفسها', { by: saved.id });
        }
      }
      await this.audit(m, a, 'import', 'file', saved.id, saved.cycle_id, opts.reason || '', {
        name, kind, size: buf.length, sha256: sha, attachments: children.length, inference: { vessel: inf.vessel, month: inf.month, conflicts: inf.conflicts },
        replaces: supersedes?.id ?? null,
      });
      return {
        duplicate: false, cycle_id: saved.cycle_id,
        file: { id: saved.id, name, kind, status: saved.status, flags, meta },
        attachments: children.map((c) => ({ position: c.position, name: c.name, class: c.class, status: c.status, flags: c.flags, meta: c.meta })),
        inference: inf,
        needs_assignment: !saved.cycle_id,
      };
    });
  }

  private async findOrCreateCycle(m: EntityManager, vessel: string, month: string, a: Actor) {
    monthBounds(month);
    const repo = m.getRepository(CrewSalaryCycle);
    const all = await repo.find({ where: { month } });
    const hit = all.find((c) => c.vessel.toLowerCase() === vessel.toLowerCase());
    if (hit) return hit;
    await repo.createQueryBuilder().insert().values({ vessel, month, status: 'draft', created_by: a.id || null }).orIgnore().execute();
    const c = (await repo.find({ where: { month } })).find((x) => x.vessel.toLowerCase() === vessel.toLowerCase())!;
    await this.audit(m, a, 'cycle_created', 'cycle', c.id, c.id, '', { vessel, month });
    return c;
  }

  async assignFile(fileId: string, vessel: string, month: string, reason: string, a: Actor) {
    const v = normalizeVessel(vessel);
    if (!v || !/^\d{4}-\d{2}$/.test(month || '')) throw new BadRequestException('المركب والشهر (YYYY-MM) مطلوبان');
    const r = need(reason);
    return this.ds.transaction(async (m) => {
      const f = await m.getRepository(CrewSalaryFile).findOne({ where: { id: fileId, parent_id: IsNull() } });
      if (!f) throw new NotFoundException('الملفّ غير موجود');
      const c = await this.findOrCreateCycle(m, v, month, a);
      await this.lock(m, [`cycle:${c.id}`]);
      await m.getRepository(CrewSalaryFile).update({ id: f.id }, { cycle_id: c.id });
      await m.getRepository(CrewSalaryFile).update({ parent_id: f.id }, { cycle_id: c.id });
      await this.audit(m, a, 'file_assigned', 'file', f.id, c.id, r, { from: f.cycle_id, vessel: v, month });
      return { cycle_id: c.id };
    });
  }

  async fileContent(fileId: string, a: Actor) {
    const f = await this.ds.getRepository(CrewSalaryFile).createQueryBuilder('f').addSelect('f.content').where('f.id = :id', { id: fileId }).getOne();
    if (!f || !f.content?.length) throw new NotFoundException('لا محتوى لهذا الملفّ');
    await this.ds.transaction((m) => this.audit(m, a, 'file_download', 'file', f.id, f.cycle_id));
    return { name: f.name, buffer: f.content };
  }

  // ══════════════════════════ المصادر والحساب ══════════════════════════
  async fxFor(month: string): Promise<FxMonth | null> {
    // سعر الشهر نفسه وحده — لا «default» ولا قيمٌ مضمَّنة
    const rates = (await this.fx.getMonth(month)) || {};
    const perUsd: Record<string, string> = {};
    for (const [k, v] of Object.entries(rates)) if (isMoney(String(v)) && Number(v) > 0) perUsd[k.toUpperCase()] = new Decimal(String(v)).toString();
    return Object.keys(perUsd).length ? { month, perUsd } : null;
  }

  private async cycleOr404(id: string) {
    const c = await this.ds.getRepository(CrewSalaryCycle).findOne({ where: { id } });
    if (!c) throw new NotFoundException('الدورة غير موجودة');
    return c;
  }

  /** يجمع الدورة كما هي الآن: الملفّات السارية + الروابط + القرارات + السعر. */
  async build(cycleId: string) {
    const cycle = await this.cycleOr404(cycleId);
    const raw = await this.ds.getRepository(CrewSalaryFile).createQueryBuilder('f')
      .addSelect('f.parsed').where('f.cycle_id = :id', { id: cycleId }).andWhere("f.status <> 'superseded'").getMany();
    // ترتيبٌ ثابت: الملفّ الأعلى بوقت رفعه ثمّ معرّفه، ومرفقاته بموضعها — فلا تتغيّر البصمة بلا سبب
    const tops = raw.filter((f) => !f.parent_id).sort((x, y) => +x.uploaded_at - +y.uploaded_at || x.id.localeCompare(y.id));
    const files: CrewSalaryFile[] = [];
    for (const t of tops) {
      files.push(t);
      files.push(...raw.filter((c) => c.parent_id === t.id).sort((x, y) => (x.position ?? 0) - (y.position ?? 0) || x.id.localeCompare(y.id)));
    }
    files.push(...raw.filter((c) => c.parent_id && !tops.some((t) => t.id === c.parent_id)));

    const blocking: string[] = [];
    const cfm: CfmExport[] = [];
    let email: ParsedEmailBody | null = null, emailFile: string | undefined;
    const payout: any[] = [], blocks: any[] = [], crew: any[] = [];
    let lashing: { file: string; rows: LashingRow[] } | null = null;
    const fileIssues: Sources['file_issues'] = [];
    const emails = files.filter((f) => f.kind === 'email' && !f.parent_id);
    if (emails.length > 1) blocking.push(`في الدورة ${emails.length} رسائل سارية — حدّد أيّها النسخة المصحَّحة (استبدال) كي لا تُحسب البنود مرّتين`);
    const cfmSeen = new Set<string>();
    for (const f of files) {
      const p = f.parsed;
      if (f.class === 'spreadsheet' && f.status === 'needs_manual') {
        fileIssues.push({ key: `file:${f.id}`, name: f.name, detail: `ملفّ Excel لم يُقرأ «${f.name}» — أدخل ما فيه يدويّاً أو استبعده بسبب` });
      }
      if (!p) continue;
      if (p.kind === 'email' && !email) { email = p.body; emailFile = f.name; }
      if (p.kind === 'cfm') {
        const x: CfmExport = p.data;
        if (cfmSeen.has(x.currency)) { blocking.push(`تصديرا CFM سارِيان بعملة ${x.currency} — استبدل أحدهما`); continue; }
        cfmSeen.add(x.currency); cfm.push(x);
      }
      if (p.kind === 'lashing_distribution' && !lashing) lashing = { file: f.name, rows: p.rows };
      const s = p as AttachmentSheet;
      if (s.kind === 'payout') payout.push(...s.rows);
      if (s.kind === 'bank_blocks') blocks.push(...s.rows);
      if (s.kind === 'crew_list') crew.push(...s.rows);
    }
    const links = new Map<string, string>();
    for (const l of await this.ds.getRepository(CrewSalaryLink).find({ where: { revoked_at: IsNull() }, order: { confirmed_at: 'ASC', id: 'ASC' } })) links.set(l.source_key, l.crew_id);
    const decisions = await this.ds.getRepository(CrewSalaryDecision).find({ where: { cycle_id: cycleId, superseded_at: IsNull() }, order: { decided_at: 'ASC', id: 'ASC' } });
    const reviews: Record<string, 'accepted' | 'rejected'> = {};
    const classify: Record<string, ItemKind> = {};
    const itemCurrency: Record<string, string> = {};
    const resolutions: Record<string, Resolution> = {};
    const paymentCurrency: Record<string, string> = {};
    const manual: NonNullable<Sources['manual']> = [];
    const supplementary: SupplementaryInput[] = [];
    for (const d of decisions) {
      const v = d.value || {};
      if (d.kind === 'item_review') reviews[d.target_key] = v.decision;
      else if (d.kind === 'item_classify') classify[d.target_key] = v.kind;
      else if (d.kind === 'item_currency') itemCurrency[d.target_key] = v.currency;
      else if (d.kind === 'resolve') resolutions[d.target_key] = { action: v.action, reason: d.reason };
      else if (d.kind === 'payment_currency') paymentCurrency[d.target_key] = v.currency;
      else if (d.kind === 'manual_item' && !v.removed) {
        manual.push({ entry_key: d.target_key.split('|')[0], item: { key: `manual:${d.id}`, kind: v.kind, amount: v.amount, currency: v.currency, reason: d.reason, source: 'manual', review: 'pending' } });
      } else if (d.kind === 'supplementary' && !v.removed) {
        supplementary.push({ source_key: d.target_key, crew_id: v.crew_id, name: v.name, currency: v.currency, amount: v.amount, kind: v.kind, reason: d.reason });
      }
    }
    const fx = await this.fxFor(cycle.month);
    const out = assemble({
      month: cycle.month, vessel: cycle.vessel, cfm, email, email_file: emailFile, payout, bank_blocks: blocks, crew_list: crew,
      lashing_pdf: lashing, links, reviews, classify, item_currency: itemCurrency, resolutions, manual, supplementary,
      payment_currency: paymentCurrency, file_issues: fileIssues,
    }, fx);

    // التصحيحات اليدويّة للحقول — ثمّ يُعاد الحساب (وشرط يوم النزول في المحرّك يسري عليها)
    const overrides = decisions.filter((d) => d.kind === 'field_override');
    for (const e of out.entries) {
      const mine = overrides.filter((d) => d.target_key.startsWith(`${e.key}|`));
      if (!mine.length) continue;
      for (const d of mine) {
        const field = d.target_key.split('|')[1];
        const v = d.value?.value;
        if (field === 'pay_start') e.input.payStart = v;
        else if (field === 'pay_end') e.input.payEnd = v;
        else if (field === 'signs_off') e.input.signsOffThisMonth = parseBool(v) === true;
        else if ((RATE_KINDS as readonly string[]).includes(field)) {
          e.input.rates = { ...(e.input.rates || { basic: '', fixed_ot: '', leave: '' }), [field]: String(v) };
        }
      }
      recompute(e, fx);
    }
    const acks = new Map(decisions.filter((d) => d.kind === 'difference_ack').map((d) => [d.target_key, d.value?.hash]));
    return { cycle, files, out, fx, decisions, acks, blocking };
  }

  /** بصمة ما يُقرّ: فروق CFM وتعارضات المصادر معاً. */
  diffHash = (e: AssembledEntry) => hashOf({ d: e.differences, c: e.source_conflicts });

  /** حال الحساب لكلّ بحّار: الحساب المعتمد، والتفويض إن لزم. */
  private async bankStatus(crewIds: string[], month: string) {
    const accounts = crewIds.length ? await this.ds.getRepository(CrewSalaryBankAccount).find({ where: { crew_id: In(crewIds) }, order: { created_at: 'DESC', id: 'ASC' } }) : [];
    const authIds = accounts.map((x) => x.authorization_id).filter(Boolean) as string[];
    const auths = authIds.length ? await this.ds.getRepository(CrewSalaryAuthorization).find({ where: { id: In(authIds) } }) : [];
    const b = monthBounds(month);
    const res = new Map<string, { accounts: CrewSalaryBankAccount[]; snapshot: SnapshotBank | null; blockers: string[] }>();
    for (const id of crewIds) {
      const mine = accounts.filter((x) => x.crew_id === id);
      const ok = mine.find((x) => x.status === 'approved') || null;
      const blockers: string[] = [];
      let snapshot: SnapshotBank | null = null;
      if (!ok) blockers.push(mine.length ? 'حسابٌ مستورَدٌ لم يُعتمد بعد' : 'لا حساب صرف');
      else {
        if (!(ok.iban || ok.account_number) || !ok.bank || !ok.beneficiary) blockers.push('بيانات الحساب المعتمد ناقصة');
        let auth: SnapshotBank['authorization'] = null;
        if (ok.beneficiary_is_seafarer === false) {
          const z = auths.find((x) => x.id === ok.authorization_id);
          const valid = z && z.status === 'approved' && (!z.valid_from || z.valid_from <= b.end) && (!z.valid_to || z.valid_to >= b.start);
          if (!valid) blockers.push('المستفيد غير البحّار بلا تفويضٍ معتمدٍ ساري');
          else auth = { id: z!.id, beneficiary: z!.beneficiary, valid_from: z!.valid_from, valid_to: z!.valid_to };
        } else if (ok.beneficiary_is_seafarer == null) blockers.push('لم يُحدَّد هل المستفيد هو البحّار');
        snapshot = {
          id: ok.id, beneficiary: ok.beneficiary, beneficiary_is_seafarer: ok.beneficiary_is_seafarer, bank: ok.bank, branch: ok.branch,
          country: ok.country, iban: ok.iban, account_number: ok.account_number, swift: ok.swift, bank_code: ok.bank_code, authorization: auth,
        };
      }
      res.set(id, { accounts: mine, snapshot, blockers });
    }
    return res;
  }

  /** الاعتمادات السارية لكلّ حالة: من استحقاقاتٍ نشطة ⇒ إصدارها ⇒ بصمة الحالة فيه. */
  private async approvals(cycleId: string): Promise<Map<string, Approval>> {
    const rows = await this.ds.query(
      `SELECT DISTINCT e.entry_key, v.id, v.version_no FROM crew_salary_entitlements e JOIN crew_salary_versions v ON v.id = e.version_id
       WHERE e.cycle_id = $1 AND e.active`, [cycleId]);
    const out = new Map<string, Approval>();
    const byVersion = new Map<string, string[]>();
    for (const r of rows) byVersion.set(r.id, [...(byVersion.get(r.id) || []), r.entry_key]);
    for (const [vid, keys] of byVersion) {
      const v = await this.ds.getRepository(CrewSalaryVersion).findOne({ where: { id: vid } });
      if (!v) continue;
      for (const k of keys) {
        const se = (v.snapshot?.entries || []).find((x: SnapshotEntry & { entry_hash?: string }) => x.key === k);
        if (se) out.set(k, { version_id: v.id, version_no: v.version_no, entry_hash: se.entry_hash, balance: se.result?.balance });
      }
    }
    return out;
  }

  /** لقطة الدورة كما هي الآن — كلّ حالةٍ بحالها واعتمادها. */
  async snapshot(cycleId: string) {
    const b = await this.build(cycleId);
    const banks = await this.bankStatus([...new Set(b.out.entries.map((e) => e.crew_id))].sort(), b.cycle.month);
    const approved = await this.approvals(cycleId);
    const entries: EntryState[] = b.out.entries.map((e) => {
      const bank = banks.get(e.crew_id)!;
      const needsAck = e.differences.length + e.source_conflicts.length > 0;
      const acked = !needsAck || b.acks.get(e.key) === this.diffHash(e);
      const blockers = [
        ...e.result.issues.filter((i) => i.blocking).map((i) => i.message),
        ...(acked ? [] : ['فروقٌ أو تعارضاتٌ لم تُراجَع']),
        ...bank.blockers,
      ];
      const core: SnapshotEntry = {
        key: e.key, crew_id: e.crew_id, name: e.name, rank: e.rank, nationality: e.nationality,
        currency: e.payment_currency, contract_currency: e.currency, payment_currency_exception: e.payment_currency_exception,
        section: e.section, result: e.result, differences: e.differences, source_conflicts: e.source_conflicts,
        differences_acknowledged: acked, bank: bank.snapshot,
        payable: e.result.complete && acked && !bank.blockers.length, blockers,
      };
      // البصمة للجوهريّ وحده: المبالغ والبنود والفروق والحساب المعتمد وقابليّة الصرف.
      // نصوص الموانع وحالة الإقرار مشتقّة — تسجيل حسابٍ مستورَدٍ لم يُعتمد لا يغيّر حالةً معتمدة
      const { blockers: _b, differences_acknowledged: _a, ...material } = core; // eslint-disable-line @typescript-eslint/no-unused-vars
      const entry_hash = hashOf(material);
      const ap = approved.get(e.key);
      const approval = ap ? { ...ap, changed: ap.entry_hash !== entry_hash } : null;
      return { ...core, entry_hash, approval, eligible: e.result.complete && acked && (!approval || approval.changed) };
    });
    return { entries, build: b, banks, approved };
  }

  /** سعر الشهر للحالات المعطاة وحدها — لا صفّ الشهر كلّه (وإلّا غيّر سعرٌ لا يخصّها بصمتها). */
  private fxFrom(fx: FxMonth | null, month: string, entries: SnapshotEntry[]): Snapshot['fx'] {
    const pairs = new Set<string>();
    for (const e of entries) for (const it of e.result.items) if (it.original_currency !== it.currency) pairs.add(`${it.original_currency}>${it.currency}`);
    for (const e of entries) for (const it of e.result.items) if (it.original_currency !== e.contract_currency && it.contract_amount != null) pairs.add(`${it.original_currency}>${e.contract_currency}`);
    if (!pairs.size) return null;
    const per: Record<string, string> = {};
    const labels: string[] = [];
    for (const p of [...pairs].sort()) {
      const [f, t] = p.split('>');
      if (f === t) continue;
      for (const c of [f, t]) if (c !== 'USD' && fx?.perUsd[c]) per[c] = fx.perUsd[c];
      const r = crossRate(fx, f, t);
      if (r) labels.push(rateLabel(f, t, r));
    }
    return { month, per_usd: per, labels };
  }

  /** بصمة الإصدار: بصمات حالاته الجوهريّة مرتّبةً، وسعر الشهر المستعمل. */
  private versionHash(cycleId: string, entries: EntryState[], fx: Snapshot['fx']) {
    return hashOf({ cycle: cycleId, entries: [...entries].sort((x, y) => x.key.localeCompare(y.key)).map((e) => [e.key, e.entry_hash]), fx });
  }

  // ══════════════════════════ العرض ══════════════════════════
  private async cycleStatus(m: EntityManager, cycleId: string): Promise<string> {
    const vs = await m.getRepository(CrewSalaryVersion).find({ where: { cycle_id: cycleId }, order: { version_no: 'DESC' } });
    if (vs.some((v) => v.status === 'submitted')) return 'submitted';
    const lastApproved = vs.find((v) => v.status === 'approved');
    if (!lastApproved) return 'draft';
    const ex = await m.getRepository(CrewSalaryExport).count({ where: { version_id: lastApproved.id, kind: 'approved_payments' } });
    return ex ? 'exported' : 'approved';
  }

  private async setStatus(m: EntityManager, cycleId: string, extra: Partial<CrewSalaryCycle> = {}) {
    await m.getRepository(CrewSalaryCycle).update({ id: cycleId }, { ...extra, status: await this.cycleStatus(m, cycleId), updated_at: new Date() });
  }

  async listCycles() {
    const cycles = await this.ds.getRepository(CrewSalaryCycle).find({ order: { month: 'DESC', vessel: 'ASC' } });
    const versions = cycles.length ? await this.ds.getRepository(CrewSalaryVersion).find({ where: { cycle_id: In(cycles.map((c) => c.id)) }, order: { version_no: 'DESC' } }) : [];
    const unassigned = await this.ds.getRepository(CrewSalaryFile).find({ where: { cycle_id: IsNull(), parent_id: IsNull(), kind: Not('authorization_doc') }, order: { uploaded_at: 'DESC' } });
    return {
      cycles: cycles.map((c) => {
        const v = versions.find((x) => x.cycle_id === c.id);
        return { ...c, latest_version: v ? { id: v.id, version_no: v.version_no, status: v.status, totals: v.totals, partial: !!v.totals?._partial } : null };
      }),
      unassigned_files: unassigned.map((f) => ({ id: f.id, name: f.name, kind: f.kind, meta: f.meta, uploaded_at: f.uploaded_at })),
    };
  }

  async view(cycleId: string, a: Actor) {
    const { entries, build: b, banks } = await this.snapshot(cycleId);
    const versions = await this.ds.getRepository(CrewSalaryVersion).find({ where: { cycle_id: cycleId }, order: { version_no: 'DESC' } });
    const approvedV = versions.find((v) => v.id === b.cycle.approved_version_id) || null;
    const exports = await this.ds.getRepository(CrewSalaryExport).find({ where: { cycle_id: cycleId }, order: { exported_at: 'DESC' } });
    const audit = await this.ds.getRepository(CrewSalaryAudit).find({ where: { cycle_id: cycleId }, order: { occurred_at: 'DESC' }, take: 200 });
    const crewIds = [...banks.keys()];
    const auths = crewIds.length ? await this.ds.getRepository(CrewSalaryAuthorization).find({ where: { crew_id: In(crewIds) }, order: { created_at: 'ASC' } }) : [];
    const byCur: Record<string, any> = {};
    for (const x of entries) {
      const t = (byCur[x.currency] ||= { count: 0, matched: 0, different: 0, ready: 0, pending: 0, eligible: 0, approved: 0, missing_account: 0, missing_docs: 0, earnings: '0.00', deductions: '0.00', balance: '0.00' });
      t.count++;
      if (x.differences.length || x.source_conflicts.length) t.different++; else t.matched++;
      if (x.payable) t.ready++; else t.pending++;
      if (x.eligible) t.eligible++;
      if (x.approval && !x.approval.changed) t.approved++;
      if (!x.bank) t.missing_account++;
      if (x.blockers.some((m) => m.includes('تفويض'))) t.missing_docs++;
      t.earnings = new Decimal(t.earnings).plus(x.result.earnings).toFixed(2);
      t.deductions = new Decimal(t.deductions).plus(x.result.deductions).toFixed(2);
      t.balance = new Decimal(t.balance).plus(x.result.balance).toFixed(2);
    }
    const assembledBy = new Map(b.out.entries.map((x) => [x.key, x]));
    const snapFx = this.fxFrom(b.fx, b.cycle.month, entries);
    return {
      cycle: b.cycle,
      permissions: await this.permissions(a),
      blocking: b.blocking,
      warnings: b.out.warnings,
      fx: { month: b.cycle.month, per_usd: b.fx?.perUsd || {}, labels: snapFx?.labels || [] },
      files: b.files.map((f) => ({ id: f.id, parent_id: f.parent_id, position: f.position, name: f.name, kind: f.kind, class: f.class, status: f.status, flags: f.flags, meta: f.meta, size: f.size, sha256: f.sha256, uploaded_at: f.uploaded_at, supersedes_id: f.supersedes_id })),
      entries: entries.map((x) => {
        const as = assembledBy.get(x.key)!;
        return {
          ...x,
          diff_hash: x.differences.length || x.source_conflicts.length ? this.diffHash(as) : null,
          provenance: as.provenance, date_checks: as.date_checks, payout_match: as.payout_match, bank_match: as.bank_match,
          bank_candidates: as.bank_candidates, accounts: banks.get(x.crew_id)?.accounts || [],
          extras: as.input.extras.map((i) => ({ key: i.key, kind: i.kind, amount: i.amount, currency: i.currency, reason: i.reason, source: i.source, review: i.review, flags: i.flags || [], duplicate_of: i.duplicate_of || null })),
        };
      }),
      unresolved: b.out.unresolved,
      unmatched: b.out.unmatched,
      authorizations: auths,
      totals: byCur,
      complete: !b.blocking.length && !b.out.unresolved.some((u) => !u.resolution) && entries.every((e) => e.approval && !e.approval.changed),
      approved_version: approvedV ? { id: approvedV.id, version_no: approvedV.version_no, decided_at: approvedV.decided_at, decided_by_name: approvedV.decided_by_name } : null,
      changed_since_approval: entries.some((e) => e.approval?.changed),
      versions: versions.map((v) => ({
        id: v.id, version_no: v.version_no, status: v.status, totals: v.totals, content_hash: v.content_hash,
        entries: (v.snapshot?.entries || []).length, excluded: (v.snapshot?.excluded || []).length,
        currencies: [...new Set((v.snapshot?.entries || []).map((e: SnapshotEntry) => e.currency))].sort(),
        submitted_by_name: v.submitted_by_name, submitted_at: v.submitted_at, submit_reason: v.submit_reason,
        decided_by_name: v.decided_by_name, decided_at: v.decided_at, decision_reason: v.decision_reason,
      })),
      exports,
      export_rows: await this.ds.query(
        `SELECT r.id, r.export_id, x.batch_no, ver.version_no, r.entry_key, r.crew_id, r.currency, r.amount::text AS amount, r.balance::text AS balance,
                r.row_kind, r.status, r.resolution_id, r.replaced_by, r.created_at
         FROM crew_salary_export_rows r JOIN crew_salary_exports x ON x.id = r.export_id JOIN crew_salary_versions ver ON ver.id = r.version_id
         WHERE r.cycle_id = $1 ORDER BY r.created_at DESC, r.id`, [cycleId]),
      batch_decisions: await this.batchDecisions(cycleId),
      audit,
    };
  }

  // ══════════════════════════ المراجعة ══════════════════════════
  async decide(cycleId: string, body: any, a: Actor) {
    const cycle = await this.cycleOr404(cycleId);
    const kind = String(body?.kind || '') as DecisionKind;
    if (!DECISION_KINDS.includes(kind)) throw new BadRequestException('نوع القرار غير معروف');
    if (kind === 'batch_resolution') return this.resolveBatch(cycle.id, body, a);
    let target = String(body?.target_key || '').slice(0, 300);
    let value: any = {};
    let reason = String(body?.reason || '').trim();
    const cur3 = (v: unknown) => { const c = String(v || '').toUpperCase(); if (!/^[A-Z]{3}$/.test(c)) throw new BadRequestException('العملة رمزٌ من ثلاثة أحرف'); return c; };
    if (!target) throw new BadRequestException('الهدف مطلوب');
    if (kind === 'item_review') {
      const d = body?.decision;
      if (d !== 'accepted' && d !== 'rejected') throw new BadRequestException('القرار: قبول أو رفض');
      if (d === 'rejected') reason = need(reason, 'سبب الرفض');
      value = { decision: d };
    } else if (kind === 'field_override') {
      const [entryKey, field] = target.split('|');
      if (!entryKey || !(OVERRIDE_FIELDS as readonly string[]).includes(field)) throw new BadRequestException('الحقل غير قابلٍ للتصحيح');
      const v = body?.value;
      if ((field === 'pay_start' || field === 'pay_end') && !/^\d{4}-\d{2}-\d{2}$/.test(String(v))) throw new BadRequestException('التاريخ بصيغة YYYY-MM-DD');
      if ((RATE_KINDS as readonly string[]).includes(field) && !(isMoney(String(v)) && Number(v) >= 0)) throw new BadRequestException('المرتّب الشهريّ رقمٌ موجب');
      if (field === 'signs_off' && parseBool(v) == null) throw new BadRequestException('القيمة: true أو false');
      reason = need(reason, 'سبب التصحيح');
      value = { value: field === 'signs_off' ? parseBool(v) : String(v) };
    } else if (kind === 'manual_item') {
      const it = body?.item || {};
      if (!MANUAL_KINDS.includes(it.kind)) throw new BadRequestException('نوع البند غير مسموح يدويّاً');
      if (!(isMoney(String(it.amount)) && Number(it.amount) > 0)) throw new BadRequestException('المبلغ رقمٌ موجب');
      const c = cur3(it.currency);
      if (!/^[^:|]+:[A-Z]{3}$/.test(target)) throw new BadRequestException('الحالة مطلوبة');
      reason = need(reason, 'سبب البند ومصدره');
      target = `${target}|${createHash('sha1').update(`${Date.now()}${Math.random()}`).digest('hex').slice(0, 10)}`;
      value = { kind: it.kind, amount: new Decimal(String(it.amount)).toFixed(2), currency: c };
    } else if (kind === 'difference_ack') {
      if (!/^[a-f0-9]{64}$/.test(String(body?.hash || ''))) throw new BadRequestException('بصمة الفروق مطلوبة');
      reason = need(reason, 'سبب قبول الفروق');
      value = { hash: body.hash };
    } else if (kind === 'item_classify') {
      if (!MANUAL_KINDS.includes(body?.item_kind)) throw new BadRequestException('التصنيف غير مسموح');
      reason = need(reason, 'سبب التصنيف');
      value = { kind: body.item_kind };
    } else if (kind === 'item_currency') {
      reason = need(reason, 'مصدر العملة');
      value = { currency: cur3(body?.currency) };
    } else if (kind === 'resolve') {
      const act = body?.action;
      if (act !== 'excluded' && act !== 'resolved') throw new BadRequestException('الحسم: استبعاد أو حُسم');
      reason = need(reason, act === 'excluded' ? 'سبب الاستبعاد' : 'كيف حُسم');
      value = { action: act };
    } else if (kind === 'supplementary') {
      const s = body?.supplementary || {};
      if (!/^\d+$/.test(String(s.crew_id || ''))) throw new BadRequestException('رقم البحّار من سجلّه المؤكَّد مطلوب — لا يُختلق رقم');
      if (!String(s.name || '').trim()) throw new BadRequestException('اسم البحّار مطلوب');
      if (!(isMoney(String(s.amount)) && Number(s.amount) > 0)) throw new BadRequestException('المبلغ رقمٌ موجب');
      if (!MANUAL_KINDS.includes(s.kind)) throw new BadRequestException('نوع البند غير مسموح');
      reason = need(reason, 'مصدر الاستحقاق ودليل هويّة البحّار');
      value = { crew_id: String(s.crew_id), name: String(s.name).trim().slice(0, 150), currency: cur3(s.currency), amount: new Decimal(String(s.amount)).toFixed(2), kind: s.kind };
    } else if (kind === 'payment_currency') {
      if (!/^[^:|]+:[A-Z]{3}$/.test(target)) throw new BadRequestException('الحالة مطلوبة');
      reason = need(reason, 'سبب الاستثناء من عملة العقد');
      value = { currency: cur3(body?.currency) };
    }
    return this.ds.transaction(async (m) => {
      await this.lock(m, [`cycle:${cycle.id}`]);
      const repo = m.getRepository(CrewSalaryDecision);
      const prev = await repo.findOne({ where: { cycle_id: cycle.id, kind, target_key: target, superseded_at: IsNull() } });
      if (prev) await repo.update({ id: prev.id }, { superseded_at: new Date() });
      const d = await repo.save(repo.create({ cycle_id: cycle.id, kind, target_key: target, value, reason, decided_by: a.id || null, decided_by_name: nameOf(a) }));
      await this.audit(m, a, `decision_${kind}`, 'decision', d.id, cycle.id, reason, { target_key: target, value, previous: prev ? { id: prev.id, value: prev.value } : null });
      return d;
    });
  }

  /** حذف بندٍ يدويّ أو مستحقٍّ تكميليّ — قرارٌ جديدٌ يُبطله، والأصل يبقى في السجلّ. */
  async removeManual(cycleId: string, decisionId: string, reason: string, a: Actor) {
    const r = need(reason);
    return this.ds.transaction(async (m) => {
      await this.lock(m, [`cycle:${cycleId}`]);
      const repo = m.getRepository(CrewSalaryDecision);
      const d = await repo.findOne({ where: { id: decisionId, cycle_id: cycleId, kind: In(['manual_item', 'supplementary']), superseded_at: IsNull() } });
      if (!d) throw new NotFoundException('البند غير موجود');
      await repo.update({ id: d.id }, { superseded_at: new Date() });
      const x = await repo.save(repo.create({ cycle_id: cycleId, kind: d.kind, target_key: d.target_key, value: { ...d.value, removed: true }, reason: r, decided_by: a.id || null, decided_by_name: nameOf(a) }));
      await this.audit(m, a, 'decision_removed', 'decision', x.id, cycleId, r, { removed: d.id, kind: d.kind });
      return { ok: true };
    });
  }

  async confirmLink(name: string, crewId: string, reason: string, cycleId: string | null, a: Actor) {
    const key = sourceKey(String(name || ''));
    if (!key || !/^\d+$/.test(String(crewId || ''))) throw new BadRequestException('الاسم ورقم البحّار مطلوبان');
    const r = need(reason);
    return this.ds.transaction(async (m) => {
      if (cycleId) await this.lock(m, [`cycle:${cycleId}`]);
      const repo = m.getRepository(CrewSalaryLink);
      const prev = await repo.findOne({ where: { source_key: key, revoked_at: IsNull() } });
      if (prev) await repo.update({ id: prev.id }, { revoked_at: new Date() });
      const l = await repo.save(repo.create({ source_key: key, crew_id: String(crewId), confirmed_by: a.id || null, confirmed_by_name: nameOf(a) }));
      await this.audit(m, a, 'link_confirmed', 'link', l.id, cycleId, r, { source_key: key, crew_id: crewId, previous: prev?.crew_id ?? null });
      return l;
    });
  }

  async revokeLink(linkId: string, reason: string, cycleId: string | null, a: Actor) {
    const r = need(reason);
    return this.ds.transaction(async (m) => {
      const l = await m.getRepository(CrewSalaryLink).findOne({ where: { id: linkId, revoked_at: IsNull() } });
      if (!l) throw new NotFoundException('الربط غير موجود');
      await m.getRepository(CrewSalaryLink).update({ id: l.id }, { revoked_at: new Date() });
      await this.audit(m, a, 'link_revoked', 'link', l.id, cycleId, r, { source_key: l.source_key, crew_id: l.crew_id });
      return { ok: true };
    });
  }

  // ══════════════════════════ الحسابات والتفويضات ══════════════════════════
  static fingerprint(x: { beneficiary?: string; bank?: string; iban?: string; account_number?: string; swift?: string; account_currency?: string | null }) {
    const n = (s?: string | null) => String(s || '').toUpperCase().replace(/\s+/g, '');
    return createHash('sha256').update([n(x.beneficiary), n(x.bank), n(x.iban), n(x.account_number), n(x.swift), n(x.account_currency)].join('|')).digest('hex');
  }

  /** يسجّل الحسابات المستخرجة للمراجعة — مستورَدةً لا معتمدة. */
  async syncBankAccounts(cycleId: string, a: Actor) {
    const b = await this.build(cycleId);
    const fileByName = new Map(b.files.map((f) => [f.name, f.id]));
    let created = 0, existing = 0;
    await this.ds.transaction(async (m) => {
      await this.lock(m, b.out.entries.map((e) => `crew:${e.crew_id}`));
      const repo = m.getRepository(CrewSalaryBankAccount);
      for (const e of b.out.entries) {
        for (const c of e.bank_candidates) {
          if (!(c.iban || c.account_number)) continue;
          const fp = CrewSalariesService.fingerprint(c);
          if (await repo.findOne({ where: { crew_id: e.crew_id, fingerprint: fp } })) { existing++; continue; }
          const acc = await repo.save(repo.create({
            crew_id: e.crew_id, beneficiary: c.beneficiary.slice(0, 200), bank: c.bank.slice(0, 200), branch: c.branch.slice(0, 200),
            country: c.country.slice(0, 80), iban: c.iban.slice(0, 64), account_number: c.account_number.slice(0, 64), swift: c.swift.slice(0, 20),
            bank_code: c.bank_code.slice(0, 40), account_currency: c.account_currency,
            source: c.source, source_file_id: (c.provenance.file && fileByName.get(c.provenance.file)) || null,
            provenance: { sheet: c.provenance.sheet, row: c.provenance.row, file: c.provenance.file }, fingerprint: fp, status: 'imported', created_by: a.id || null,
          }));
          created++;
          await this.audit(m, a, 'bank_imported', 'bank_account', acc.id, cycleId, '', { crew_id: e.crew_id, source: c.source });
        }
      }
    });
    return { created, existing };
  }

  async addBankAccount(body: any, a: Actor, cycleId: string | null) {
    const crew = String(body?.crew_id || '');
    if (!/^\d+$/.test(crew)) throw new BadRequestException('رقم البحّار مطلوب');
    const r = need(body?.reason, 'مصدر الحساب');
    const f = (k: string, n: number) => String(body?.[k] ?? '').trim().slice(0, n);
    const acc = { beneficiary: f('beneficiary', 200), bank: f('bank', 200), branch: f('branch', 200), country: f('country', 80), iban: f('iban', 64).replace(/\s+/g, '').toUpperCase(), account_number: f('account_number', 64).replace(/\s+/g, ''), swift: f('swift', 20).toUpperCase(), bank_code: f('bank_code', 40), account_currency: body?.account_currency ? f('account_currency', 3).toUpperCase() : null };
    if (!(acc.iban || acc.account_number) || !acc.bank || !acc.beneficiary) throw new BadRequestException('المستفيد والبنك وIBAN أو رقم الحساب مطلوبة');
    const fp = CrewSalariesService.fingerprint(acc);
    return this.ds.transaction(async (m) => {
      await this.lock(m, [`crew:${crew}`]);
      const repo = m.getRepository(CrewSalaryBankAccount);
      if (await repo.findOne({ where: { crew_id: crew, fingerprint: fp } })) throw new ConflictException('الحساب نفسه مسجَّلٌ لهذا البحّار');
      const x = await repo.save(repo.create({ crew_id: crew, ...acc, source: 'manual', provenance: { note: r }, fingerprint: fp, status: 'imported', created_by: a.id || null }));
      await this.audit(m, a, 'bank_added', 'bank_account', x.id, cycleId, r, { crew_id: crew });
      return x;
    });
  }

  async reviewBankAccount(id: string, body: any, a: Actor, cycleId: string | null) {
    this.assertApprover(a);
    const decision = body?.decision;
    if (decision !== 'approved' && decision !== 'rejected') throw new BadRequestException('القرار: اعتماد أو رفض');
    const r = need(body?.reason);
    const pre = await this.ds.getRepository(CrewSalaryBankAccount).findOne({ where: { id } });
    if (!pre) throw new NotFoundException('الحساب غير موجود');
    return this.ds.transaction(async (m) => {
      await this.lock(m, [`crew:${pre.crew_id}`]);
      const repo = m.getRepository(CrewSalaryBankAccount);
      const acc = (await repo.findOne({ where: { id } }))!;
      if (decision === 'approved') {
        if (!(acc.iban || acc.account_number) || !acc.bank || !acc.beneficiary) throw new BadRequestException('بيانات الحساب ناقصة — لا يُعتمد');
        const isSeafarer = parseBool(body?.beneficiary_is_seafarer);
        if (isSeafarer == null) throw new BadRequestException('حدّد هل المستفيد هو البحّار نفسه');
        let authId: string | null = null;
        if (!isSeafarer) {
          authId = String(body?.authorization_id || '');
          const z = authId ? await m.getRepository(CrewSalaryAuthorization).findOne({ where: { id: authId } }) : null;
          if (!z || z.crew_id !== acc.crew_id || z.status !== 'approved') throw new BadRequestException('المستفيد غير البحّار يلزمه تفويضٌ معتمدٌ موثَّق لهذا البحّار');
        }
        const old = await repo.findOne({ where: { crew_id: acc.crew_id, status: 'approved' } });
        if (old && old.id !== acc.id) {
          await repo.update({ id: old.id }, { status: 'retired' });
          await this.audit(m, a, 'bank_retired', 'bank_account', old.id, cycleId, `استُبدل بالحساب ${acc.id}`, { crew_id: acc.crew_id });
        }
        await repo.update({ id }, { status: 'approved', beneficiary_is_seafarer: isSeafarer, authorization_id: authId, reviewed_by: a.id, reviewed_by_name: nameOf(a), reviewed_at: new Date(), review_reason: r });
      } else {
        await repo.update({ id }, { status: 'rejected', reviewed_by: a.id, reviewed_by_name: nameOf(a), reviewed_at: new Date(), review_reason: r });
      }
      await this.audit(m, a, `bank_${decision}`, 'bank_account', id, cycleId, r, { crew_id: acc.crew_id });
      return { ok: true };
    });
  }

  async createAuthorization(body: any, doc: { buffer: Buffer; originalname: string } | undefined, a: Actor, cycleId: string | null) {
    const crew = String(body?.crew_id || '');
    if (!/^\d+$/.test(crew)) throw new BadRequestException('رقم البحّار مطلوب');
    const beneficiary = String(body?.beneficiary || '').trim().slice(0, 200);
    if (!beneficiary) throw new BadRequestException('اسم المستفيد مطلوب');
    if (!doc?.buffer?.length) throw new BadRequestException('مستند التفويض مطلوب');
    if (doc.buffer.length > MAX_FILE) throw new BadRequestException('المستند أكبر من الحدّ المسموح');
    const ext = extOf(doc.originalname);
    if (!['.pdf', '.jpg', '.jpeg', '.png'].includes(ext)) throw new BadRequestException('المستند: PDF أو صورة');
    const d = (k: string) => (/^\d{4}-\d{2}-\d{2}$/.test(String(body?.[k] || '')) ? String(body[k]) : null);
    return this.ds.transaction(async (m) => {
      await this.lock(m, [`crew:${crew}`]);
      const sha = sha256(doc.buffer);
      let f = await m.getRepository(CrewSalaryFile).findOne({ where: { sha256: sha, parent_id: IsNull() } });
      if (!f) {
        f = await m.getRepository(CrewSalaryFile).save(m.getRepository(CrewSalaryFile).create({
          cycle_id: null, kind: 'authorization_doc', name: doc.originalname.slice(0, 255), ext, size: doc.buffer.length, sha256: sha,
          content: doc.buffer, class: ext === '.pdf' ? 'pdf' : 'image', status: 'stored', flags: ext === '.pdf' ? pdfActiveContent(doc.buffer).map((x) => `active_${x}`) : [], meta: { crew_id: crew }, uploaded_by: a.id || null,
        }));
      }
      const z = await m.getRepository(CrewSalaryAuthorization).save(m.getRepository(CrewSalaryAuthorization).create({
        crew_id: crew, beneficiary, relation: String(body?.relation || '').slice(0, 120), document_file_id: f.id,
        valid_from: d('valid_from'), valid_to: d('valid_to'), status: 'pending', note: String(body?.note || '').slice(0, 2000), created_by: a.id || null,
      }));
      await this.audit(m, a, 'authorization_created', 'authorization', z.id, cycleId, z.note, { crew_id: crew, document: f.id });
      return z;
    });
  }

  async reviewAuthorization(id: string, body: any, a: Actor, cycleId: string | null) {
    this.assertApprover(a);
    const decision = body?.decision;
    if (!['approved', 'rejected', 'revoked'].includes(decision)) throw new BadRequestException('القرار غير معروف');
    const r = need(body?.reason);
    const pre = await this.ds.getRepository(CrewSalaryAuthorization).findOne({ where: { id } });
    if (!pre) throw new NotFoundException('التفويض غير موجود');
    return this.ds.transaction(async (m) => {
      await this.lock(m, [`crew:${pre.crew_id}`]);
      if (decision === 'approved' && !pre.document_file_id) throw new BadRequestException('لا تفويض بلا مستندٍ موثَّق');
      await m.getRepository(CrewSalaryAuthorization).update({ id }, { status: decision, reviewed_by: a.id, reviewed_by_name: nameOf(a), reviewed_at: new Date(), review_reason: r });
      await this.audit(m, a, `authorization_${decision}`, 'authorization', id, cycleId, r, { crew_id: pre.crew_id });
      return { ok: true };
    });
  }

  // ══════════════════════════ سعر الصرف ══════════════════════════
  /**
   * «١ CUR = X USD» — يُكتب في جدول `exchange_rates` القائم بصيغته (كم وحدةً لكلّ دولار)،
   * ذرّيّاً لعملةٍ واحدة. تعديل أسعار الشركة لمن يملك شاشة التقارير (الصلاحية القائمة لتعديلها)،
   * لا لمن يملك شاشة المرتّبات وحدها. والإصدار المعتمد يحتفظ بلقطته فلا يتأثّر.
   */
  async setFx(month: string, currency: string, usdPerUnit: string, reason: string, a: Actor) {
    if (!a.id || !(await this.authz.can(a.id, FX_EDIT_SCREEN))) {
      throw new ForbiddenException('تعديل أسعار الشركة لمن يملك صلاحية شاشة التقارير — شاشة المرتّبات وحدها لا تكفي');
    }
    if (!/^\d{4}-\d{2}$/.test(month || '')) throw new BadRequestException('الشهر بصيغة YYYY-MM');
    const cur = String(currency || '').toUpperCase();
    if (!/^[A-Z]{3}$/.test(cur) || cur === 'USD') throw new BadRequestException('العملة رمزٌ من ثلاثة أحرف غير الدولار');
    const raw = String(usdPerUnit ?? '').trim();
    if (!/^\d+(\.\d{1,6})?$/.test(raw) || !(Number(raw) > 0)) throw new BadRequestException('السعر رقمٌ موجب بستّ منازل عشريّة على الأكثر');
    const r = need(reason, 'مصدر السعر');
    const x = new Decimal(raw);
    // يُخزَّن مقلوباً بخمسة عشر رقماً معنويّاً — ويُستردّ بستّ منازل مطابقاً للمدخَل حرفيّاً
    const perUsd = new Decimal(1).div(x).toSignificantDigits(15).toString();
    const label = `1 ${cur} = ${x.toFixed(6)} USD`;
    return this.ds.transaction(async (m) => {
      await this.lock(m, [`fx:${month}`]);
      const before = (await m.query('SELECT rates FROM exchange_rates WHERE month = $1', [month]))[0]?.rates || {};
      const after = await this.fx.setOne(month, cur, perUsd, m);
      await this.audit(m, a, 'fx_set', 'fx', `${month}:${cur}`, null, r, { month, currency: cur, label, per_usd_before: before[cur] ?? null, per_usd_after: after[cur] });
      return { month, currency: cur, per_usd: after[cur], label };
    });
  }

  // ══════════════════════════ التقديم والاعتماد ══════════════════════════
  /**
   * تقديم الحالات المكتملة المختارة (أو كلّ المكتملة) بإصدارٍ جديد. المعلّقة تبقى خارجه ظاهرةً
   * بأسبابها، والمعتمدة بلا تغيير لا تُعاد، والمعتمدة المعدَّلة تدخل مراجَعةً لإصدارها السابق.
   */
  async submit(cycleId: string, reason: string, a: Actor, keys?: string[]) {
    const r = need(reason, 'ملاحظة التقديم');
    return this.ds.transaction(async (m) => {
      await this.lock(m, [`cycle:${cycleId}`]);
      const { entries, build: b } = await this.snapshot(cycleId);
      if (b.blocking.length) throw new BadRequestException({ message: 'لا يُقدَّم قبل حلّ الموانع', blockers: b.blocking });
      const eligible = entries.filter((e) => e.eligible);
      let included = eligible;
      if (keys?.length) {
        const bad = keys.filter((k) => !eligible.some((e) => e.key === k));
        if (bad.length) {
          throw new BadRequestException({ message: 'حالاتٌ مختارة غير جاهزة للتقديم', entries: bad.map((k) => { const e = entries.find((x) => x.key === k); return { crew_id: e?.crew_id ?? k, currency: e?.currency ?? '', blockers: e ? (e.approval && !e.approval.changed ? [`معتمَدة في الإصدار ${e.approval.version_no} دون تغيير`] : e.blockers) : ['غير موجودة'] }; }) });
        }
        included = eligible.filter((e) => keys.includes(e.key));
      }
      if (!included.length) {
        throw new BadRequestException({ message: 'لا حالة جاهزة للتقديم', entries: entries.filter((e) => !e.eligible && !(e.approval && !e.approval.changed)).map((e) => ({ crew_id: e.crew_id, currency: e.currency, blockers: e.blockers })) });
      }
      const inc = new Set(included.map((e) => e.key));
      const excluded = entries.filter((e) => !inc.has(e.key) && !(e.approval && !e.approval.changed))
        .map((e) => ({ key: e.key, crew_id: e.crew_id, currency: e.currency, balance: e.result.balance, reasons: e.eligible ? ['لم تُختَر في هذا التقديم'] : e.blockers }));
      const already = entries.filter((e) => e.approval && !e.approval.changed).map((e) => ({ key: e.key, version_no: e.approval!.version_no }));
      const fx = this.fxFrom(b.fx, b.cycle.month, included);
      const strip = ({ approval, eligible: _e, ...rest }: EntryState) => ({ ...rest, revises: approval ? approval.version_no : undefined }); // eslint-disable-line @typescript-eslint/no-unused-vars
      const snap: Snapshot & { entries: (SnapshotEntry & { entry_hash: string; revises?: number })[] } = {
        cycle: { id: b.cycle.id, vessel: b.cycle.vessel, month: b.cycle.month },
        entries: [...included].sort((x, y) => x.key.localeCompare(y.key)).map(strip),
        fx, excluded, already_approved: already, unresolved_open: b.out.unresolved.filter((u) => !u.resolution).length,
      };
      const hash = this.versionHash(cycleId, included, fx);
      const totals: Record<string, any> = { _partial: excluded.length + already.length > 0 };
      for (const e of included) {
        const t = (totals[e.currency] ||= { count: 0, payable: 0, balance: '0.00', payable_balance: '0.00' });
        t.count++; t.balance = new Decimal(t.balance).plus(e.result.balance).toFixed(2);
        if (e.payable) { t.payable++; t.payable_balance = new Decimal(t.payable_balance).plus(e.result.balance).toFixed(2); }
      }
      const vr = m.getRepository(CrewSalaryVersion);
      const pending = await vr.findOne({ where: { cycle_id: cycleId, status: 'submitted' } });
      if (pending && pending.content_hash === hash) throw new ConflictException(`الإصدار ${pending.version_no} بالمحتوى نفسه مقدَّمٌ سلفاً`);
      await vr.createQueryBuilder().update().set({ status: 'superseded' }).where('cycle_id = :c AND status = :s', { c: cycleId, s: 'submitted' }).execute();
      const last = await vr.findOne({ where: { cycle_id: cycleId }, order: { version_no: 'DESC' } });
      const v = await vr.save(vr.create({
        cycle_id: cycleId, version_no: (last?.version_no || 0) + 1, status: 'submitted', snapshot: snap, totals, fx_snapshot: fx,
        content_hash: hash, submitted_by: a.id || null, submitted_by_name: nameOf(a), submit_reason: r,
      }));
      await this.setStatus(m, cycleId, { current_version: v.version_no });
      await this.audit(m, a, 'submitted', 'version', v.id, cycleId, r, { version_no: v.version_no, content_hash: hash, entries: included.length, excluded: excluded.length, already_approved: already.length });
      return { id: v.id, version_no: v.version_no, totals, entries: included.length, excluded };
    });
  }

  static entitlementKey(month: string, e: SnapshotEntry, it: SnapshotEntry['result']['items'][number]) {
    const base = `${e.crew_id}|${e.currency}|${it.kind}`;
    if ((RATE_KINDS as readonly string[]).includes(it.kind)) return `${base}|${e.result.service.start}|${e.result.service.end}`;
    if (it.kind === 'sign_off_day') return `${base}|${e.result.service.end}`;
    return `${base}|${month}|${it.key}`;
  }

  async approve(versionId: string, reason: string, a: Actor) {
    this.assertApprover(a);
    const r = need(reason, 'ملاحظة الاعتماد');
    const pre = await this.ds.getRepository(CrewSalaryVersion).findOne({ where: { id: versionId } });
    if (!pre) throw new NotFoundException('الإصدار غير موجود');
    const cycle = await this.cycleOr404(pre.cycle_id);
    const crews: string[] = (pre.snapshot?.entries || []).map((e: SnapshotEntry) => `crew:${e.crew_id}`);

    return this.ds.transaction(async (m) => {
      // الأقفال أوّلاً ثمّ كلّ تحقّق: لا يمرّ تعديلٌ على الدورة أو البحّارة أو السعر بين التحقّق والاعتماد
      await this.lock(m, [`cycle:${cycle.id}`, ...crews, `fx:${cycle.month}`]);
      const vr = m.getRepository(CrewSalaryVersion);
      const v = await vr.createQueryBuilder('v').setLock('pessimistic_write').where('v.id = :id', { id: versionId }).getOne();
      if (!v || v.status !== 'submitted') throw new ConflictException('الإصدار ليس مقدَّماً للاعتماد (رُبّما اعتُمد أو رُفض للتوّ)');
      const newer = await vr.createQueryBuilder('v').where('v.cycle_id = :c AND v.version_no > :n', { c: v.cycle_id, n: v.version_no }).getCount();
      if (newer) throw new ConflictException('يوجد إصدارٌ أحدث — اعتمد الأحدث');
      const s: Snapshot & { entries: (SnapshotEntry & { entry_hash: string })[] } = v.snapshot;
      const keys = new Set(s.entries.map((e) => e.key));
      const { entries } = await this.snapshot(v.cycle_id);
      const now = entries.filter((e) => keys.has(e.key));
      if (now.length !== keys.size || now.some((e) => !e.eligible)) throw new ConflictException('تغيّرت حالاتٌ في الإصدار بعد تقديمه — أعِد التقديم');
      const b = await this.fxFor(cycle.month);
      if (this.versionHash(v.cycle_id, now, this.fxFrom(b, cycle.month, now)) !== v.content_hash) {
        throw new ConflictException('تغيّرت البيانات بعد التقديم — أعِد التقديم بإصدارٍ جديد');
      }

      const er = m.getRepository(CrewSalaryEntitlement);
      const rows: Partial<CrewSalaryEntitlement>[] = [];
      for (const e of s.entries) {
        for (const it of e.result.items) {
          if (!it.counted || it.amount == null) continue;
          rows.push({
            version_id: v.id, cycle_id: v.cycle_id, crew_id: e.crew_id, currency: e.currency, kind: it.kind, entry_key: e.key,
            period_start: e.result.service.start, period_end: e.result.service.end, amount: it.amount,
            entitlement_key: CrewSalariesService.entitlementKey(s.cycle.month, e, it), active: true,
          });
        }
      }
      // تداخل فترة الخدمة مع استحقاقٍ معتمدٍ في دورةٍ أخرى — تحت قفل البحّار، فلا سباق
      const conflicts: string[] = [];
      for (const x of rows.filter((x) => (RATE_KINDS as readonly string[]).includes(x.kind!) && x.period_start && x.period_end)) {
        const hit = await er.createQueryBuilder('t')
          .where('t.active AND t.crew_id = :c AND t.kind = :k AND t.cycle_id <> :cy', { c: x.crew_id, k: x.kind, cy: v.cycle_id })
          .andWhere('t.period_start <= :e AND t.period_end >= :s', { s: x.period_start, e: x.period_end }).getOne();
        if (hit) conflicts.push(`${x.crew_id} ${x.kind} ${x.period_start}→${x.period_end} يتداخل مع استحقاقٍ معتمد ${hit.period_start}→${hit.period_end}`);
      }
      if (conflicts.length) throw new ConflictException({ message: 'استحقاقٌ مكرَّر — لا يُعتمد', conflicts });

      // الحالات المعدَّلة: تُطفأ استحقاقاتها السابقة في الدورة نفسها — حالةً حالة لا الإصدار كلّه
      const replaced = new Set<string>();
      for (const k of keys) {
        const old = await er.find({ where: { cycle_id: v.cycle_id, entry_key: k, active: true } });
        for (const o of old) replaced.add(o.version_id);
        if (old.length) await er.update({ cycle_id: v.cycle_id, entry_key: k, active: true }, { active: false });
      }
      try {
        if (rows.length) await er.insert(rows);
      } catch (err: any) {
        if (err?.code === '23505') throw new ConflictException({ message: 'استحقاقٌ معتمدٌ من قبل — لا يُعتمد مرّتين', detail: String(err.detail || '').slice(0, 300) });
        throw err;
      }
      for (const oldId of replaced) {
        const still = await er.count({ where: { version_id: oldId, active: true } });
        if (!still) await vr.update({ id: oldId }, { status: 'superseded' });
      }
      await vr.update({ id: v.id }, { status: 'approved', decided_by: a.id, decided_by_name: nameOf(a), decided_at: new Date(), decision_reason: r });
      await this.setStatus(m, v.cycle_id, { approved_version_id: v.id });
      await this.audit(m, a, 'approved', 'version', v.id, v.cycle_id, r, { version_no: v.version_no, content_hash: v.content_hash, entitlements: rows.length, replaced: [...replaced] });
      return { ok: true, version_no: v.version_no, entitlements: rows.length };
    });
  }

  async reject(versionId: string, reason: string, a: Actor) {
    this.assertApprover(a);
    const r = need(reason, 'سبب الرفض');
    const pre = await this.ds.getRepository(CrewSalaryVersion).findOne({ where: { id: versionId } });
    if (!pre) throw new NotFoundException('الإصدار غير موجود');
    return this.ds.transaction(async (m) => {
      await this.lock(m, [`cycle:${pre.cycle_id}`]);
      const vr = m.getRepository(CrewSalaryVersion);
      const v = await vr.createQueryBuilder('v').setLock('pessimistic_write').where('v.id = :id', { id: versionId }).getOne();
      if (!v || v.status !== 'submitted') throw new ConflictException('الإصدار ليس مقدَّماً للاعتماد');
      await vr.update({ id: v.id }, { status: 'rejected', decided_by: a.id, decided_by_name: nameOf(a), decided_at: new Date(), decision_reason: r });
      await this.setStatus(m, v.cycle_id);
      await this.audit(m, a, 'rejected', 'version', v.id, v.cycle_id, r, { version_no: v.version_no });
      return { ok: true };
    });
  }

  // ══════════════════════════ التصدير ══════════════════════════
  async exportReview(cycleId: string, a: Actor) {
    const { entries, build: b } = await this.snapshot(cycleId);
    const now = new Date().toISOString();
    const snap: Snapshot = { cycle: { id: b.cycle.id, vessel: b.cycle.vessel, month: b.cycle.month }, entries, fx: this.fxFrom(b.fx, b.cycle.month, entries) };
    const buffer = buildReviewWorkbook(snap, { exported_at: now, status: b.cycle.status, version_no: b.cycle.current_version || null, unresolved: b.out.unresolved });
    const batch = `REV-${vesselSlug(b.cycle.vessel)}-${b.cycle.month.replace('-', '')}-${now.slice(0, 19).replace(/\D/g, '')}`;
    await this.ds.transaction(async (m) => {
      await m.getRepository(CrewSalaryExport).insert({ cycle_id: cycleId, version_id: null, kind: 'review', batch_no: batch, currency: null, file_sha256: sha256(buffer), row_count: entries.length, exported_by: a.id || null, exported_by_name: nameOf(a) });
      await this.audit(m, a, 'export_review', 'export', batch, cycleId, '', { entries: entries.length });
    });
    return { buffer, filename: `${batch}.xlsx` };
  }

  /** مفاتيح الحالات الموجودة في الدورة الآن — ما خرج تحت مفتاحٍ غاب منها (تغيّرت عملته) يُعدّ خروجاً سابقاً للبحّار. */
  private async liveKeys(cycleId: string) {
    return new Set((await this.build(cycleId)).out.entries.map((e) => e.key));
  }

  /**
   * سياق دفعةٍ لإصدارٍ معتمد: حالاتٌ حلّ محلّها إصدارٌ أحدث، والصفوف السارية التي خرجت فعلاً
   * (من جدول صفوف الدفعات — لا من لقطات الإصدارات)، وقرارات المالك القائمة. يُقرأ داخل القفل.
   */
  private async paymentContext(m: EntityManager, cycleId: string, v: CrewSalaryVersion, live?: Set<string>): Promise<PaymentContext> {
    const s: Snapshot = v.snapshot;
    const keys = new Set(s.entries.map((e) => e.key));
    const ctx = emptyContext();
    const active = await m.query(
      `SELECT DISTINCT e.entry_key, v.version_no FROM crew_salary_entitlements e JOIN crew_salary_versions v ON v.id = e.version_id
       WHERE e.cycle_id = $1 AND e.active`, [cycleId]);
    for (const r of active) if (r.version_no !== v.version_no && keys.has(r.entry_key)) ctx.superseded.set(r.entry_key, r.version_no);
    // كلّ العملات: حالةٌ خرجت بعملةٍ ثمّ تغيّرت عملة دفعها لا تخرج بالثانية كأنّها جديدة
    ctx.rows = await m.query(
      `SELECT r.id, x.batch_no, ver.version_no, r.entry_key, r.crew_id, r.currency, r.amount::text AS amount, r.balance::text AS balance,
              r.entry_hash, r.bank_id, r.row_kind
       FROM crew_salary_export_rows r
       JOIN crew_salary_exports x ON x.id = r.export_id
       JOIN crew_salary_versions ver ON ver.id = r.version_id
       WHERE r.cycle_id = $1 AND r.status = 'active' ORDER BY r.created_at, r.id`, [cycleId]);
    ctx.replacedKeys = new Set((await m.query(
      `SELECT DISTINCT entry_key FROM crew_salary_export_rows r WHERE cycle_id = $1 AND status = 'replaced'
         AND NOT EXISTS (SELECT 1 FROM crew_salary_export_rows a WHERE a.cycle_id = r.cycle_id AND a.entry_key = r.entry_key AND a.status = 'active')`,
      [cycleId])).map((r: { entry_key: string }) => r.entry_key));
    ctx.live = live;
    const ds = await m.getRepository(CrewSalaryDecision).find({ where: { cycle_id: cycleId, kind: 'batch_resolution', superseded_at: IsNull() } });
    ctx.resolutions = ds.map((d) => ({
      id: d.id, row_id: d.value?.row_id, action: d.value?.action, amount: d.value?.amount ?? null,
      entry_hash: d.value?.entry_hash, reason: d.reason, decided_by_name: d.decided_by_name,
    }));
    return ctx;
  }

  /**
   * قرار المالك في حالةٍ خرجت ثمّ تغيّرت — لا يُستنتج السداد من التصدير، فلا خصم ولا إعادةٌ آليّة.
   * القرار على آخر صفٍّ خرج للحالة، ولمحتواها في إصدارها المعتمد الساري — فلا يسري على تعديلٍ لاحق.
   *   replace: ما خرج لم يُنفَّذ ⇒ يُستبدل، ويخرج الصافي الجديد كاملاً (وإن لم يكن موجباً يُلغى ما خرج فوراً بلا بديل).
   *   settle:  ما خرج نُفِّذ ⇒ مبلغٌ إضافيّ صريح (موجب، ولا يتجاوز الصافي الجديد).
   *   keep:    لا يخرج شيء.
   */
  async resolveBatch(cycleId: string, body: any, a: Actor) {
    this.assertApprover(a);
    const action = String(body?.action || '');
    if (!['replace', 'settle', 'keep'].includes(action)) throw new BadRequestException('القرار: استبدال أو تسوية أو إبقاء');
    const reason = need(body?.reason, action === 'replace' ? 'ما يثبت أنّ الدفعة السابقة لم تُنفَّذ' : action === 'settle' ? 'سبب التسوية ومستندها' : 'سبب الإبقاء');
    const rowId = String(body?.row_id || '');
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(rowId)) throw new BadRequestException('صفّ الدفعة مطلوب');
    let amount: string | null = null;
    if (action === 'settle') {
      if (!(isMoney(String(body?.amount ?? '')) && Number(body.amount) > 0)) throw new BadRequestException('مبلغ التسوية رقمٌ موجب');
      amount = new Decimal(String(body.amount)).toFixed(2);
    }
    await this.cycleOr404(cycleId);
    return this.ds.transaction(async (m) => {
      await this.lock(m, [`cycle:${cycleId}`]);
      const rr = m.getRepository(CrewSalaryExportRow);
      const row = await rr.findOne({ where: { id: rowId, cycle_id: cycleId } });
      if (!row) throw new NotFoundException('صفّ الدفعة غير موجود');
      if (row.status !== 'active') throw new ConflictException('استُبدل هذا الصفّ من قبل');
      const last = (await m.query(
        `SELECT id FROM crew_salary_export_rows WHERE cycle_id = $1 AND entry_key = $2 AND status = 'active' ORDER BY created_at DESC, id DESC LIMIT 1`,
        [cycleId, row.entry_key]))[0];
      if (last?.id !== row.id) throw new ConflictException('خرج لهذه الحالة صفٌّ أحدث — القرار على آخر ما خرج');
      // الحالة المقصودة: حالة الصفّ نفسها، أو — إن تغيّرت عملتها فصار لها مفتاحٌ جديد — حالة البحّار
      // الجديدة، بشرط أن يكون مفتاح الصفّ قد غاب من الدورة وألّا يكون للحالة الجديدة صفٌّ ساري
      const key = String(body?.entry_key || row.entry_key).slice(0, 80);
      if (key !== row.entry_key) {
        if (key.split(':')[0] !== row.crew_id) throw new BadRequestException('الحالة لبحّارٍ آخر');
        if ((await this.liveKeys(cycleId)).has(row.entry_key)) throw new BadRequestException('الحالة التي خرج لها الصفّ ما زالت قائمة — القرار عليها');
        if (await rr.count({ where: { cycle_id: cycleId, entry_key: key, status: 'active' } })) throw new ConflictException('للحالة الجديدة صفٌّ خرج — القرار على آخر صفوفها');
      }
      const holder = (await m.query(`SELECT DISTINCT version_id FROM crew_salary_entitlements WHERE cycle_id = $1 AND entry_key = $2 AND active`, [cycleId, key]))[0];
      const v = holder ? await m.getRepository(CrewSalaryVersion).findOne({ where: { id: holder.version_id } }) : null;
      const se = (v?.snapshot?.entries || []).find((e: SnapshotEntry) => e.key === key) as (SnapshotEntry & { entry_hash: string }) | undefined;
      if (!v || !se) throw new ConflictException('لا اعتماد ساري لهذه الحالة');
      const bankChanged = (row.bank_id || null) !== (se.bank?.id || null);
      if (key === row.entry_key && se.entry_hash === row.entry_hash && !bankChanged) throw new BadRequestException('لم تتغيّر الحالة منذ خروجها — لا قرار يلزم');
      if (action === 'settle' && new Decimal(amount!).gt(se.result.balance)) throw new BadRequestException(`التسوية لا تتجاوز الصافي المعتمد (${se.result.balance})`);
      const prior = await rr.find({ where: { cycle_id: cycleId, entry_key: row.entry_key, status: 'active' } });
      const exported = prior.map((p) => `${p.amount} ${p.currency}`).join(' + ');
      const target = `${key}|${row.id}`;
      const repo = m.getRepository(CrewSalaryDecision);
      const prev = await repo.findOne({ where: { cycle_id: cycleId, kind: 'batch_resolution', target_key: target, superseded_at: IsNull() } });
      if (prev) await repo.update({ id: prev.id }, { superseded_at: new Date() });
      // استبدالٌ والصافي الجديد ليس موجباً: لا بديل يخرج، فيُلغى ما خرج الآن (صفوفه «مُستبدَلة» بالقرار نفسه)
      const cancel = action === 'replace' && !new Decimal(se.result.balance).gt(0);
      const value = {
        action, amount, row_id: row.id, entry_key: key, row_entry_key: row.entry_key, entry_hash: se.entry_hash, version_id: v.id, version_no: v.version_no,
        exported, balance: se.result.balance, currency: se.currency, bank_changed: bankChanged, cancelled_without_replacement: cancel,
      };
      const d = await repo.save(repo.create({ cycle_id: cycleId, kind: 'batch_resolution', target_key: target, value, reason, decided_by: a.id || null, decided_by_name: nameOf(a) }));
      if (cancel) await rr.update({ id: In(prior.map((p) => p.id)), status: 'active' }, { status: 'replaced', replaced_by: d.id, replaced_at: new Date() });
      await this.audit(m, a, 'decision_batch_resolution', 'decision', d.id, cycleId, reason, { target_key: target, value, previous: prev ? { id: prev.id, value: prev.value } : null });
      return d;
    });
  }

  /** الحالات التي خرجت ثمّ تغيّرت في الإصدارات المعتمدة السارية — ما ينتظر قرار المالك وما قُرِّر ولم يخرج. */
  private async batchDecisions(cycleId: string) {
    const versions = await this.ds.getRepository(CrewSalaryVersion).find({ where: { cycle_id: cycleId, status: 'approved' }, order: { version_no: 'DESC' } });
    const out: any[] = [];
    const seen = new Set<string>();
    const live = versions.length ? await this.liveKeys(cycleId) : undefined;
    for (const v of versions) {
      const ctx = await this.paymentContext(this.ds.manager, cycleId, v, live);
      for (const cur of [...new Set((v.snapshot?.entries || []).map((e: SnapshotEntry) => e.currency))] as string[]) {
        const p = payableEntries(v.snapshot, cur, ctx);
        const rows = [
          ...p.pending.map((x) => ({ state: 'pending', entry: x.entry, row: x.row, prior: x.prior, resolution: null as any, amount_changed: x.amount_changed, bank_changed: x.bank_changed })),
          ...p.included.filter((x) => x.resolution).map((x) => ({ state: 'decided', entry: x.entry, row: x.prior[x.prior.length - 1], prior: x.prior, resolution: x.resolution, ...changedSince(x.prior[x.prior.length - 1], x.entry) })),
        ];
        for (const k of p.excluded.filter((x) => x.resolution)) {
          rows.push({ state: 'kept', entry: k.entry, row: k.row!, prior: ctx.rows.filter((b) => b.entry_key === k.entry.key), resolution: k.resolution!, ...changedSince(k.row!, k.entry) });
        }
        for (const r of rows) {
          if (seen.has(r.entry.key)) continue;
          seen.add(r.entry.key);
          out.push({
            state: r.state, entry_key: r.entry.key, crew_id: r.entry.crew_id, name: r.entry.name, currency: r.entry.currency,
            version_id: v.id, version_no: v.version_no, balance: r.entry.result.balance, row_id: r.row.id,
            prior: r.prior.map((b) => ({ batch_no: b.batch_no, amount: b.amount, currency: b.currency, row_kind: b.row_kind, version_no: b.version_no })),
            amount_changed: r.amount_changed, bank_changed: r.bank_changed,
            resolution: r.resolution ? { action: r.resolution.action, amount: r.resolution.amount, reason: r.resolution.reason, decided_by_name: r.resolution.decided_by_name } : null,
          });
        }
      }
    }
    return out;
  }

  /**
   * كشف صرف إصدارٍ معتمد بعملة دفعٍ واحدة — كلّه داخل قفل الدورة (القفل نفسه الذي يأخذه الاعتماد):
   * يُعاد قراءة الإصدار وحالته والاستحقاقات السارية والصفوف التي خرجت وقرارات المالك **بعد** القفل،
   * ثمّ يُبنى الملفّ ويُسجَّل هو وصفوفه في المعاملة نفسها. فلا يُعتمد إصدارٌ مصحَّح بين التحقّق والتسجيل.
   *
   * الدفعة = الصفوف التي تخرج فيها فعلاً. طلبٌ لا جديد فيه يعيد آخر دفعةٍ للإصدار والعملة حرفيّاً؛
   * وجديدٌ بعد دفعةٍ سابقة (قرار مالكٍ مثلاً) يخرج دفعةً تالية برقمٍ تالٍ لا تكرّر ما خرج.
   */
  async exportPayments(cycleId: string, currency: string, a: Actor, versionId?: string) {
    const cur = String(currency || '').toUpperCase();
    if (!/^[A-Z]{3}$/.test(cur)) throw new BadRequestException('العملة مطلوبة');
    await this.cycleOr404(cycleId);
    return this.ds.transaction(async (m) => {
      await this.lock(m, [`cycle:${cycleId}`]);
      const cycle = (await m.getRepository(CrewSalaryCycle).findOne({ where: { id: cycleId } }))!;
      const vr = m.getRepository(CrewSalaryVersion);
      const v = versionId ? await vr.findOne({ where: { id: versionId, cycle_id: cycleId } }) : cycle.approved_version_id ? await vr.findOne({ where: { id: cycle.approved_version_id } }) : null;
      if (!v || !v.decided_by || !['approved', 'superseded'].includes(v.status) || v.decided_at == null) {
        throw new BadRequestException('لا إصدار معتمد — كشف الصرف من إصدارٍ معتمدٍ وحده');
      }
      const s: Snapshot = v.snapshot;
      const xr = m.getRepository(CrewSalaryExport);
      const batches = await xr.createQueryBuilder('x').addSelect('x.content')
        .where('x.cycle_id = :c AND x.version_id = :v AND x.kind = :k AND x.currency = :cur AND x.is_redownload = false', { c: cycleId, v: v.id, k: 'approved_payments', cur })
        .orderBy('x.exported_at', 'DESC').getMany();
      const historical = v.status === 'superseded';
      const ctx = historical ? null : await this.paymentContext(m, cycleId, v, await this.liveKeys(cycleId));
      const plan = ctx ? payableEntries(s, cur, ctx) : null;

      if (!plan?.included.length) {
        const last = batches[0];
        const pending = plan?.pending.length || 0;
        if (last?.content) {
          await xr.insert({ cycle_id: cycleId, version_id: v.id, kind: 'approved_payments', batch_no: last.batch_no, currency: cur, file_sha256: last.file_sha256, row_count: last.row_count, is_redownload: true, exported_by: a.id || null, exported_by_name: nameOf(a) });
          await this.audit(m, a, historical ? 'export_payments_historical' : 'export_payments_redownload', 'export', last.batch_no, cycleId, '', { version_no: v.version_no, currency: cur, pending });
          return { buffer: last.content, filename: `${last.batch_no}.xlsx`, redownload: true, historical, pending };
        }
        if (historical) throw new ConflictException('حلّ محلّ هذا الإصدار إصدارٌ أحدث ولم يُصدَّر قبل ذلك — صدِّر من الإصدار الساري');
        if (!s.entries.some((e) => e.currency === cur)) throw new BadRequestException(`لا حالات بعملة ${cur} في الإصدار المعتمد`);
        throw new BadRequestException(pending
          ? `لا مستحقّ جديد بعملة ${cur} — ${pending} حالة خرجت ثمّ تغيّرت وتنتظر قرار المالك`
          : `لا حالات مكتملة بمستحقٍّ جديد بعملة ${cur} في الإصدار المعتمد`);
      }

      const batch = `CS-${vesselSlug(cycle.vessel)}-${cycle.month.replace('-', '')}-V${v.version_no}-${cur}${batches.length ? `-B${batches.length + 1}` : ''}`;
      const out = buildPaymentsWorkbook(s, {
        batch_no: batch, currency: cur, exported_at: new Date().toISOString(), version_no: v.version_no,
        approved_by: v.decided_by_name, approved_at: v.decided_at ? new Date(v.decided_at).toISOString() : '',
      }, ctx!);
      const x = await xr.insert({
        cycle_id: cycleId, version_id: v.id, kind: 'approved_payments', batch_no: batch, currency: cur, file_sha256: sha256(out.buffer),
        row_count: out.rows, is_redownload: false, content: out.buffer, exported_by: a.id || null, exported_by_name: nameOf(a),
      });
      const exportId = x.identifiers[0].id as string;
      const rr = m.getRepository(CrewSalaryExportRow);
      for (const r of out.included) {
        if (!r.entry.entry_hash) throw new ConflictException('لقطة الإصدار بلا بصمة حالة — أعِد التقديم');
        const id = randomUUID();
        // الاستبدال أوّلاً (الفهرس الفريد: صفٌّ كاملٌ ساري واحد للحالة)، بالقرار الذي أجازه
        if (r.replaces.length) await rr.update({ id: In(r.replaces), status: 'active' }, { status: 'replaced', replaced_by: id, replaced_at: new Date() });
        await rr.insert({
          id, export_id: exportId, cycle_id: cycleId, version_id: v.id, entry_key: r.entry.key, crew_id: r.entry.crew_id, currency: cur,
          entry_hash: r.entry.entry_hash, bank_id: r.entry.bank?.id || null, balance: r.entry.result.balance, amount: r.due,
          row_kind: r.kind, resolution_id: r.resolution?.id || null,
        });
      }
      await this.setStatus(m, cycleId);
      await this.audit(m, a, 'export_payments', 'export', batch, cycleId, '', {
        version_no: v.version_no, currency: cur, rows: out.rows, total: out.total, pending: out.pending.length,
        entries: out.included.map((r) => ({ key: r.entry.key, kind: r.kind, amount: r.due, replaces: r.replaces.length, resolution_id: r.resolution?.id || null })),
      });
      return { buffer: out.buffer, filename: `${batch}.xlsx`, redownload: false, historical: false, pending: out.pending.length };
    });
  }

  /** دفعةٌ بعينها كما خرجت أوّل مرّة — حرفيّاً، وتُسجَّل إعادة تنزيل. */
  async downloadExport(exportId: string, a: Actor) {
    const x = await this.ds.getRepository(CrewSalaryExport).createQueryBuilder('x').addSelect('x.content')
      .where('x.id = :id AND x.kind = :k AND x.is_redownload = false', { id: exportId, k: 'approved_payments' }).getOne();
    if (!x?.content) throw new NotFoundException('الدفعة غير موجودة');
    const v = x.version_id ? await this.ds.getRepository(CrewSalaryVersion).findOne({ where: { id: x.version_id } }) : null;
    const historical = v?.status === 'superseded';
    await this.ds.transaction(async (m) => {
      await m.getRepository(CrewSalaryExport).insert({ cycle_id: x.cycle_id, version_id: x.version_id, kind: 'approved_payments', batch_no: x.batch_no, currency: x.currency, file_sha256: x.file_sha256, row_count: x.row_count, is_redownload: true, exported_by: a.id || null, exported_by_name: nameOf(a) });
      await this.audit(m, a, historical ? 'export_payments_historical' : 'export_payments_redownload', 'export', x.batch_no, x.cycle_id, '', { version_no: v?.version_no ?? null, currency: x.currency, export_id: x.id });
    });
    return { buffer: x.content, filename: `${x.batch_no}.xlsx`, historical };
  }
}

/** ما تغيّر في الحالة منذ آخر صفٍّ خرج لها — المبلغ أو الحساب — يُعرض للمالك قبل قراره وبعده. */
function changedSince(row: { balance: string; bank_id: string | null }, e: SnapshotEntry) {
  return { amount_changed: !new Decimal(row.balance).eq(e.result.balance), bank_changed: (row.bank_id || null) !== (e.bank?.id || null) };
}

export type { ExtraItemInput };
