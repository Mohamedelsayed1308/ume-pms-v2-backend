import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { createHash } from 'crypto';
import Decimal from 'decimal.js';
import { DataSource, EntityManager, In, IsNull, Not } from 'typeorm';
import { ExchangeRatesService } from '../exchange-rates/exchange-rates.service';
import { approverId, isApprover } from './crew-salary.approver';
import { assemble, type AssembledEntry, type Sources } from './crew-salary.assemble';
import {
  compareWithReported, computeEntry, crossRate, isMoney, monthBounds, rateLabel, RATE_KINDS,
  type ExtraItemInput, type FxMonth, type ItemKind,
} from './crew-salary.calc';
import {
  CrewSalaryAudit, CrewSalaryAuthorization, CrewSalaryBankAccount, CrewSalaryCycle, CrewSalaryDecision,
  CrewSalaryEntitlement, CrewSalaryExport, CrewSalaryFile, CrewSalaryLink, CrewSalaryVersion,
} from './crew-salary.entity';
import { buildPaymentsWorkbook, buildReviewWorkbook, payableEntries, type Snapshot, type SnapshotBank, type SnapshotEntry } from './crew-salary.export';
import { combine, monthFromText, normalizeVessel, vesselFromBody } from './crew-salary.infer';
import { sourceKey } from './crew-salary.match';
import { parseAttachmentWorkbook, type AttachmentSheet } from './parsers/attachments.parser';
import { isCfmWorkbook, parseCfm, readWorkbook, type CfmExport } from './parsers/cfm.parser';
import { parseEmailBody, type ParsedEmailBody } from './parsers/email-body.parser';
import { extOf, parseMsg, pdfActiveContent, pdfHasTextLayer, sha256 } from './parsers/msg.parser';

/**
 * مرتّبات أطقم السفن — سير العمل على القاعدة.
 *
 * الاستيراد ⇐ الاستخراج ⇐ المراجعة (قراراتٌ تُستبدل ولا تُمحى) ⇐ التقديم (لقطةٌ مجمّدة)
 * ⇐ الاعتماد (المعتمد الوحيد، وتسجيل الاستحقاقات بفهرسٍ فريد) ⇐ التصدير (ليس سداداً).
 *
 * لا يُطبع في السجلّات شيءٌ من محتوى الملفّات ولا بيانات البنوك والهويّة.
 */

export interface Actor { id: string; email?: string; full_name?: string; role?: string }

export const SCREEN = '/dashboard/fleet-crew-salaries';
export const DECISION_KINDS = ['item_review', 'field_override', 'manual_item', 'difference_ack'] as const;
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
const hashOf = (v: unknown) => createHash('sha256').update(stableStringify(v)).digest('hex');
const nameOf = (a: Actor) => (a.full_name || a.email || '').slice(0, 150);
const need = (reason: unknown, what = 'السبب') => {
  const r = String(reason ?? '').trim();
  if (r.length < 3) throw new BadRequestException(`${what} مطلوبٌ (ثلاثة أحرفٍ على الأقلّ)`);
  return r.slice(0, 2000);
};
const vesselSlug = (v: string) => v.toUpperCase().replace(/[^A-Z0-9]+/g, '').slice(0, 12) || 'VESSEL';

@Injectable()
export class CrewSalariesService {
  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    private readonly fx: ExchangeRatesService,
  ) {}

  // ══════════════════════════ التدقيق ══════════════════════════
  private async audit(m: EntityManager, a: Actor, action: string, entity: string, entityId: string, cycleId: string | null, reason = '', details: Record<string, any> = {}) {
    await m.getRepository(CrewSalaryAudit).insert({
      cycle_id: cycleId, entity, entity_id: String(entityId || ''), action,
      user_id: a.id || null, user_email: (a.email || '').slice(0, 255), user_name: nameOf(a), reason, details: details as any,
    });
  }

  permissions(a: Actor) {
    return { approver_configured: !!approverId(), can_approve: isApprover(a.id) };
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
    if (ext !== '.msg' && ext !== '.xlsx') {
      throw new BadRequestException('المقبول: رسالة Outlook ‎.msg أو ملفّ Excel ‎.xlsx (بلا ماكرو)');
    }
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
      meta = { subject: msg.subject.slice(0, 300), from: msg.from.slice(0, 200), sent_at: msg.sent_at, tables: body.tables.length, rows: body.tables.reduce((n, t) => n + t.rows.length, 0), notes: body.notes.length };
      votes.push({ month: monthFromText(msg.subject), source: 'موضوع الرسالة' });
      votes.push({ vessel: vesselFromBody(msg.body), source: 'نصّ الرسالة' });
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
              c.parsed = s; c.status = s.kind === 'unknown' ? 'needs_manual' : 'extracted';
              c.meta = { sheet_kind: s.kind, rows: 'rows' in s ? s.rows.length : 0 };
              if (s.kind === 'payout') votes.push({ vessel: normalizeVessel(s.vessel), source: `كشف الصرف «${at.name}»` });
              if (s.kind === 'crew_list') votes.push({ vessel: normalizeVessel(s.vessel), source: `قائمة الطاقم «${at.name}»` });
              if (s.kind === 'unknown') c.flags = ['unrecognized_sheet'];
            }
          } catch {
            c.status = 'needs_manual'; c.flags = ['unreadable'];
          }
        } else if (at.class === 'pdf') {
          const active = pdfActiveContent(at.content);
          c.flags = [pdfHasTextLayer(at.content) ? 'pdf_text_layer' : 'pdf_scanned', ...active.map((x) => `active_${x}`)];
          // النصّ لا يُستخرج من الـPDF في هذه المرحلة — يُحفظ دليلاً، والبيانات من نظيره xlsx أو يدويّاً
          c.status = 'needs_manual';
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
        meta = { sheet_kind: s.kind, rows: s.rows.length };
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
        if (!supersedes || supersedes.parent_id) throw new BadRequestException('الملفّ المُستبدَل غير موجود');
        if (supersedes.kind !== kind) throw new BadRequestException('النسخة المصحَّحة يجب أن تكون من نوع الملفّ الأصليّ نفسه');
        need(opts.reason, 'سبب الاستبدال');
      }
      const saved = await m.getRepository(CrewSalaryFile).save(m.getRepository(CrewSalaryFile).create({
        cycle_id: cycle?.id ?? supersedes?.cycle_id ?? null, kind, name, ext, mime: null, size: buf.length, sha256: sha,
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
        await m.getRepository(CrewSalaryFile).update({ parent_id: supersedes.id }, { status: 'superseded' });
      }
      // تصدير CFM جديدٌ بالعملة نفسها يحلّ محلّ السابق في الدورة
      if (kind === 'cfm' && saved.cycle_id) {
        const prev = await m.getRepository(CrewSalaryFile).find({ where: { cycle_id: saved.cycle_id, kind: 'cfm', parent_id: IsNull(), id: Not(saved.id), status: Not('superseded') } });
        for (const p of prev.filter((p) => p.meta?.cfm_currency === meta.cfm_currency)) {
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
    const c = await repo.save(repo.create({ vessel, month, status: 'draft', created_by: a.id || null }));
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
    const files = await this.ds.getRepository(CrewSalaryFile).createQueryBuilder('f')
      .addSelect('f.parsed').where('f.cycle_id = :id', { id: cycleId }).andWhere("f.status <> 'superseded'").orderBy('f.uploaded_at', 'ASC').getMany();
    const blocking: string[] = [];
    const cfm: CfmExport[] = [];
    let email: ParsedEmailBody | null = null, emailFile: string | undefined;
    const payout: any[] = [], blocks: any[] = [], crew: any[] = [];
    const emails = files.filter((f) => f.kind === 'email' && !f.parent_id);
    if (emails.length > 1) blocking.push(`في الدورة ${emails.length} رسائل سارية — حدّد أيّها النسخة المصحَّحة (استبدال) كي لا تُحسب البنود مرّتين`);
    const cfmSeen = new Set<string>();
    for (const f of files) {
      const p = f.parsed;
      if (!p) continue;
      if (p.kind === 'email' && !email) { email = p.body; emailFile = f.name; }
      if (p.kind === 'cfm') {
        const x: CfmExport = p.data;
        if (cfmSeen.has(x.currency)) { blocking.push(`تصديرا CFM سارِيان بعملة ${x.currency} — استبدل أحدهما`); continue; }
        cfmSeen.add(x.currency); cfm.push(x);
      }
      const s = p as AttachmentSheet;
      if (s.kind === 'payout') payout.push(...s.rows);
      if (s.kind === 'bank_blocks') blocks.push(...s.rows);
      if (s.kind === 'crew_list') crew.push(...s.rows);
    }
    const links = new Map<string, string>();
    for (const l of await this.ds.getRepository(CrewSalaryLink).find({ where: { revoked_at: IsNull() } })) links.set(l.source_key, l.crew_id);
    const decisions = await this.ds.getRepository(CrewSalaryDecision).find({ where: { cycle_id: cycleId, superseded_at: IsNull() }, order: { decided_at: 'ASC' } });
    const reviews: Record<string, 'accepted' | 'rejected'> = {};
    const manual: Sources['manual'] = [];
    for (const d of decisions) {
      if (d.kind === 'item_review') reviews[d.target_key] = d.value?.decision;
      if (d.kind === 'manual_item' && !d.value?.removed) {
        const [crew_id, currency] = d.target_key.split('|')[0].split(':');
        manual.push({ crew_id, currency, item: { key: `manual:${d.id}`, kind: d.value.kind, amount: d.value.amount, currency: d.value.currency, reason: d.reason, source: 'manual', review: 'pending' } });
      }
    }
    const fx = await this.fxFor(cycle.month);
    const out = assemble({ month: cycle.month, vessel: cycle.vessel, cfm, email, email_file: emailFile, payout, bank_blocks: blocks, crew_list: crew, links, reviews, manual }, fx);

    // التصحيحات اليدويّة للحقول — ثمّ يُعاد الحساب
    const overrides = decisions.filter((d) => d.kind === 'field_override');
    for (const e of out.entries) {
      const mine = overrides.filter((d) => d.target_key.startsWith(`${e.key}|`));
      if (!mine.length) continue;
      for (const d of mine) {
        const field = d.target_key.split('|')[1];
        const v = d.value?.value;
        if (field === 'pay_start') e.input.payStart = v;
        else if (field === 'pay_end') e.input.payEnd = v;
        else if (field === 'signs_off') e.input.signsOffThisMonth = !!v;
        else if ((RATE_KINDS as readonly string[]).includes(field)) {
          e.input.rates = { ...(e.input.rates || { basic: '', fixed_ot: '', leave: '' }), [field]: String(v) };
        }
      }
      e.result = computeEntry(e.input, fx);
      e.differences = compareWithReported(e.result, e.reported, e.reported_balance);
    }
    const acks = new Map(decisions.filter((d) => d.kind === 'difference_ack').map((d) => [d.target_key, d.value?.hash]));
    return { cycle, files, out, fx, decisions, acks, blocking };
  }

  diffHash = (e: AssembledEntry) => hashOf(e.differences);

  /** حال الحساب لكلّ بحّار: الحساب المعتمد، والتفويض إن لزم. */
  private async bankStatus(crewIds: string[], month: string) {
    const accounts = crewIds.length ? await this.ds.getRepository(CrewSalaryBankAccount).find({ where: { crew_id: In(crewIds) }, order: { created_at: 'DESC' } }) : [];
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
          country: ok.country, iban: ok.iban, account_number: ok.account_number, swift: ok.swift, bank_code: ok.bank_code,
          national_id_last4: ok.national_id ? ok.national_id.slice(-4) : '', authorization: auth,
        };
      }
      res.set(id, { accounts: mine, snapshot, blockers });
    }
    return res;
  }

  /** لقطة الدورة كما هي الآن — ما يُقدَّم للاعتماد ويُصدَّر. */
  async snapshot(cycleId: string) {
    const b = await this.build(cycleId);
    const banks = await this.bankStatus([...new Set(b.out.entries.map((e) => e.crew_id))], b.cycle.month);
    const entries: SnapshotEntry[] = b.out.entries.map((e) => {
      const bank = banks.get(e.crew_id)!;
      const acked = !e.differences.length || b.acks.get(e.key) === this.diffHash(e);
      const blockers = [
        ...e.result.issues.filter((i) => i.blocking).map((i) => i.message),
        ...(acked ? [] : ['فروقٌ عن CFM لم تُراجَع']),
        ...bank.blockers,
      ];
      return {
        key: e.key, crew_id: e.crew_id, name: e.name, rank: e.rank, nationality: e.nationality, currency: e.currency, section: e.section,
        result: e.result, differences: e.differences, differences_acknowledged: acked, bank: bank.snapshot,
        payable: e.result.complete && acked && !bank.blockers.length, blockers,
      };
    });
    const fxLabels: string[] = [];
    if (b.fx) {
      const curs = new Set<string>();
      for (const e of b.out.entries) for (const it of e.result.items) if (it.original_currency !== it.currency) curs.add(`${it.original_currency}>${it.currency}`);
      for (const p of curs) { const [f, t] = p.split('>'); const r = crossRate(b.fx, f, t); if (r) fxLabels.push(rateLabel(f, t, r)); }
    }
    const snap: Snapshot = {
      cycle: { id: b.cycle.id, vessel: b.cycle.vessel, month: b.cycle.month },
      entries,
      fx: b.fx ? { month: b.fx.month, per_usd: b.fx.perUsd, labels: fxLabels } : null,
      files: b.files.filter((f) => f.status !== 'ignored' && f.status !== 'rejected').map((f) => ({ id: f.id, name: f.name, kind: f.kind, sha256: f.sha256 })),
      decisions: b.decisions.map((d) => d.id),
    };
    return { snap, build: b, banks };
  }

  // ══════════════════════════ العرض ══════════════════════════
  async listCycles() {
    const cycles = await this.ds.getRepository(CrewSalaryCycle).find({ order: { month: 'DESC', vessel: 'ASC' } });
    const versions = cycles.length ? await this.ds.getRepository(CrewSalaryVersion).find({ where: { cycle_id: In(cycles.map((c) => c.id)) }, order: { version_no: 'DESC' } }) : [];
    const unassigned = await this.ds.getRepository(CrewSalaryFile).find({ where: { cycle_id: IsNull(), parent_id: IsNull(), kind: Not('authorization_doc') }, order: { uploaded_at: 'DESC' } });
    return {
      cycles: cycles.map((c) => {
        const v = versions.find((x) => x.cycle_id === c.id);
        return { ...c, latest_version: v ? { id: v.id, version_no: v.version_no, status: v.status, totals: v.totals } : null };
      }),
      unassigned_files: unassigned.map((f) => ({ id: f.id, name: f.name, kind: f.kind, meta: f.meta, uploaded_at: f.uploaded_at })),
    };
  }

  async view(cycleId: string, a: Actor) {
    const { snap, build: b, banks } = await this.snapshot(cycleId);
    const hash = hashOf(snap);
    const versions = await this.ds.getRepository(CrewSalaryVersion).find({ where: { cycle_id: cycleId }, order: { version_no: 'DESC' } });
    const approved = versions.find((v) => v.id === b.cycle.approved_version_id) || null;
    const exports = await this.ds.getRepository(CrewSalaryExport).find({ where: { cycle_id: cycleId }, order: { exported_at: 'DESC' } });
    const audit = await this.ds.getRepository(CrewSalaryAudit).find({ where: { cycle_id: cycleId }, order: { occurred_at: 'DESC' }, take: 200 });
    const authIds = [...banks.values()].flatMap((x) => x.accounts.map((y) => y.authorization_id)).filter(Boolean) as string[];
    const crewIds = [...banks.keys()];
    const auths = crewIds.length ? await this.ds.getRepository(CrewSalaryAuthorization).find({ where: { crew_id: In(crewIds) } }) : [];
    const e = snap.entries;
    const byCur: Record<string, any> = {};
    for (const x of e) {
      const t = (byCur[x.currency] ||= { count: 0, matched: 0, different: 0, ready: 0, pending: 0, missing_account: 0, missing_docs: 0, earnings: '0.00', deductions: '0.00', balance: '0.00' });
      t.count++;
      if (x.differences.length) t.different++; else t.matched++;
      if (x.payable) t.ready++; else t.pending++;
      if (!x.bank) t.missing_account++;
      if (x.blockers.some((m) => m.includes('تفويض'))) t.missing_docs++;
      t.earnings = new Decimal(t.earnings).plus(x.result.earnings).toFixed(2);
      t.deductions = new Decimal(t.deductions).plus(x.result.deductions).toFixed(2);
      t.balance = new Decimal(t.balance).plus(x.result.balance).toFixed(2);
    }
    const assembledBy = new Map(b.out.entries.map((x) => [x.key, x]));
    return {
      cycle: b.cycle,
      permissions: this.permissions(a),
      blocking: b.blocking,
      warnings: b.out.warnings,
      fx: { month: b.cycle.month, per_usd: b.fx?.perUsd || {}, labels: snap.fx?.labels || [] },
      files: b.files.map((f) => ({ id: f.id, parent_id: f.parent_id, position: f.position, name: f.name, kind: f.kind, class: f.class, status: f.status, flags: f.flags, meta: f.meta, size: f.size, sha256: f.sha256, uploaded_at: f.uploaded_at, supersedes_id: f.supersedes_id })),
      entries: e.map((x) => {
        const as = assembledBy.get(x.key)!;
        return {
          ...x,
          diff_hash: x.differences.length ? this.diffHash(as) : null,
          provenance: as.provenance, date_checks: as.date_checks, payout_match: as.payout_match, bank_match: as.bank_match,
          bank_candidates: as.bank_candidates, accounts: banks.get(x.crew_id)?.accounts || [],
          extras: as.input.extras.map((i) => ({ key: i.key, kind: i.kind, amount: i.amount, currency: i.currency, reason: i.reason, source: i.source, review: i.review })),
        };
      }),
      unmatched: b.out.unmatched,
      authorizations: auths,
      totals: byCur,
      current_hash: hash,
      approved_version: approved ? { id: approved.id, version_no: approved.version_no, decided_at: approved.decided_at, decided_by_name: approved.decided_by_name, content_hash: approved.content_hash } : null,
      changed_since_approval: !!approved && approved.content_hash !== hash,
      versions: versions.map((v) => ({ id: v.id, version_no: v.version_no, status: v.status, totals: v.totals, content_hash: v.content_hash, submitted_by_name: v.submitted_by_name, submitted_at: v.submitted_at, submit_reason: v.submit_reason, decided_by_name: v.decided_by_name, decided_at: v.decided_at, decision_reason: v.decision_reason })),
      exports,
      audit,
      linked_auth_ids: authIds,
    };
  }

  // ══════════════════════════ المراجعة ══════════════════════════
  async decide(cycleId: string, body: any, a: Actor) {
    const cycle = await this.cycleOr404(cycleId);
    const kind = String(body?.kind || '') as DecisionKind;
    if (!DECISION_KINDS.includes(kind)) throw new BadRequestException('نوع القرار غير معروف');
    let target = String(body?.target_key || '').slice(0, 300);
    let value: any = {};
    let reason = String(body?.reason || '').trim();
    if (kind === 'item_review') {
      const d = body?.decision;
      if (d !== 'accepted' && d !== 'rejected') throw new BadRequestException('القرار: قبول أو رفض');
      if (d === 'rejected') reason = need(reason, 'سبب الرفض');
      if (!target) throw new BadRequestException('البند مطلوب');
      value = { decision: d };
    } else if (kind === 'field_override') {
      const [entryKey, field] = target.split('|');
      if (!entryKey || !(OVERRIDE_FIELDS as readonly string[]).includes(field)) throw new BadRequestException('الحقل غير قابلٍ للتصحيح');
      const v = body?.value;
      if ((field === 'pay_start' || field === 'pay_end') && !/^\d{4}-\d{2}-\d{2}$/.test(String(v))) throw new BadRequestException('التاريخ بصيغة YYYY-MM-DD');
      if ((RATE_KINDS as readonly string[]).includes(field) && !(isMoney(String(v)) && Number(v) >= 0)) throw new BadRequestException('المرتّب الشهريّ رقمٌ موجب');
      reason = need(reason, 'سبب التصحيح');
      value = { value: field === 'signs_off' ? !!v : String(v) };
    } else if (kind === 'manual_item') {
      const it = body?.item || {};
      if (!MANUAL_KINDS.includes(it.kind)) throw new BadRequestException('نوع البند غير مسموح يدويّاً');
      if (!(isMoney(String(it.amount)) && Number(it.amount) > 0)) throw new BadRequestException('المبلغ رقمٌ موجب');
      if (!/^[A-Z]{3}$/.test(String(it.currency || ''))) throw new BadRequestException('العملة مطلوبة (رمزٌ من ثلاثة أحرف)');
      if (!/^[^:|]+:[A-Z]{3}$/.test(target)) throw new BadRequestException('البحّار مطلوب');
      reason = need(reason, 'سبب البند ومصدره');
      target = `${target}|${createHash('sha1').update(`${Date.now()}${Math.random()}`).digest('hex').slice(0, 10)}`;
      value = { kind: it.kind, amount: new Decimal(String(it.amount)).toFixed(2), currency: it.currency };
    } else if (kind === 'difference_ack') {
      if (!/^[a-f0-9]{64}$/.test(String(body?.hash || ''))) throw new BadRequestException('بصمة الفروق مطلوبة');
      reason = need(reason, 'سبب قبول الفروق');
      value = { hash: body.hash };
    }
    return this.ds.transaction(async (m) => {
      const repo = m.getRepository(CrewSalaryDecision);
      const prev = await repo.findOne({ where: { cycle_id: cycle.id, kind, target_key: target, superseded_at: IsNull() } });
      if (prev) await repo.update({ id: prev.id }, { superseded_at: new Date() });
      const d = await repo.save(repo.create({ cycle_id: cycle.id, kind, target_key: target, value, reason, decided_by: a.id || null, decided_by_name: nameOf(a) }));
      await this.audit(m, a, `decision_${kind}`, 'decision', d.id, cycle.id, reason, { target_key: target, value, previous: prev ? { id: prev.id, value: prev.value } : null });
      return d;
    });
  }

  /** حذف بندٍ يدويّ — قرارٌ جديدٌ يُبطله، والأصل يبقى في السجلّ. */
  async removeManual(cycleId: string, decisionId: string, reason: string, a: Actor) {
    const r = need(reason);
    return this.ds.transaction(async (m) => {
      const repo = m.getRepository(CrewSalaryDecision);
      const d = await repo.findOne({ where: { id: decisionId, cycle_id: cycleId, kind: 'manual_item', superseded_at: IsNull() } });
      if (!d) throw new NotFoundException('البند اليدويّ غير موجود');
      await repo.update({ id: d.id }, { superseded_at: new Date() });
      const x = await repo.save(repo.create({ cycle_id: cycleId, kind: 'manual_item', target_key: d.target_key, value: { ...d.value, removed: true }, reason: r, decided_by: a.id || null, decided_by_name: nameOf(a) }));
      await this.audit(m, a, 'decision_manual_removed', 'decision', x.id, cycleId, r, { removed: d.id });
      return { ok: true };
    });
  }

  async confirmLink(name: string, crewId: string, reason: string, cycleId: string | null, a: Actor) {
    const key = sourceKey(String(name || ''));
    if (!key || !/^\d+$/.test(String(crewId || ''))) throw new BadRequestException('الاسم ورقم البحّار مطلوبان');
    const r = need(reason);
    return this.ds.transaction(async (m) => {
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
      const repo = m.getRepository(CrewSalaryBankAccount);
      for (const e of b.out.entries) {
        for (const c of e.bank_candidates) {
          if (!(c.iban || c.account_number)) continue;
          const fp = CrewSalariesService.fingerprint(c);
          if (await repo.findOne({ where: { crew_id: e.crew_id, fingerprint: fp } })) { existing++; continue; }
          const acc = await repo.save(repo.create({
            crew_id: e.crew_id, beneficiary: c.beneficiary.slice(0, 200), bank: c.bank.slice(0, 200), branch: c.branch.slice(0, 200),
            country: c.country.slice(0, 80), iban: c.iban.slice(0, 64), account_number: c.account_number.slice(0, 64), swift: c.swift.slice(0, 20),
            bank_code: c.bank_code.slice(0, 40), account_currency: c.account_currency, national_id: c.national_id.slice(0, 20),
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
    return this.ds.transaction(async (m) => {
      const repo = m.getRepository(CrewSalaryBankAccount);
      const acc = await repo.findOne({ where: { id } });
      if (!acc) throw new NotFoundException('الحساب غير موجود');
      if (decision === 'approved') {
        if (!(acc.iban || acc.account_number) || !acc.bank || !acc.beneficiary) throw new BadRequestException('بيانات الحساب ناقصة — لا يُعتمد');
        const isSeafarer = body?.beneficiary_is_seafarer;
        if (typeof isSeafarer !== 'boolean') throw new BadRequestException('حدّد هل المستفيد هو البحّار نفسه');
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
    return this.ds.transaction(async (m) => {
      const z = await m.getRepository(CrewSalaryAuthorization).findOne({ where: { id } });
      if (!z) throw new NotFoundException('التفويض غير موجود');
      if (decision === 'approved' && !z.document_file_id) throw new BadRequestException('لا تفويض بلا مستندٍ موثَّق');
      await m.getRepository(CrewSalaryAuthorization).update({ id }, { status: decision, reviewed_by: a.id, reviewed_by_name: nameOf(a), reviewed_at: new Date(), review_reason: r });
      await this.audit(m, a, `authorization_${decision}`, 'authorization', id, cycleId, r, { crew_id: z.crew_id });
      return { ok: true };
    });
  }

  // ══════════════════════════ سعر الصرف ══════════════════════════
  /**
   * «١ CUR = X USD» — يُكتب في جدول `exchange_rates` القائم بصيغته (كم وحدةً لكلّ دولار)،
   * لشهرٍ بعينه، ويبقى باقي العملات كما هي. والإصدار المعتمد يحتفظ بلقطته فلا يتأثّر.
   */
  async setFx(month: string, currency: string, usdPerUnit: string, reason: string, a: Actor) {
    if (!/^\d{4}-\d{2}$/.test(month || '')) throw new BadRequestException('الشهر بصيغة YYYY-MM');
    const cur = String(currency || '').toUpperCase();
    if (!/^[A-Z]{3}$/.test(cur) || cur === 'USD') throw new BadRequestException('العملة رمزٌ من ثلاثة أحرف غير الدولار');
    if (!(isMoney(String(usdPerUnit)) && Number(usdPerUnit) > 0)) throw new BadRequestException('السعر رقمٌ موجب');
    const r = need(reason, 'مصدر السعر');
    const perUsd = new Decimal(1).div(String(usdPerUnit)).toSignificantDigits(15);
    const before = (await this.fx.getMonth(month)) || {};
    const next = { ...before, [cur]: perUsd.toNumber() };
    await this.fx.upsert(month, next);
    await this.ds.transaction((m) => this.audit(m, a, 'fx_set', 'fx', `${month}:${cur}`, null, r, {
      month, currency: cur, label: `1 ${cur} = ${new Decimal(String(usdPerUnit)).toFixed(6)} USD`, per_usd_before: before[cur] ?? null, per_usd_after: next[cur],
    }));
    return { month, currency: cur, per_usd: next[cur], label: `1 ${cur} = ${new Decimal(String(usdPerUnit)).toFixed(6)} USD` };
  }

  // ══════════════════════════ التقديم والاعتماد ══════════════════════════
  async submit(cycleId: string, reason: string, a: Actor) {
    const r = need(reason, 'ملاحظة التقديم');
    const { snap, build: b } = await this.snapshot(cycleId);
    if (b.blocking.length) throw new BadRequestException({ message: 'لا يُقدَّم قبل حلّ الموانع', blockers: b.blocking });
    if (!snap.entries.length) throw new BadRequestException('لا بحّارة في الدورة');
    const calc = snap.entries.filter((e) => !e.result.complete || !e.differences_acknowledged)
      .map((e) => ({ crew_id: e.crew_id, currency: e.currency, blockers: e.blockers.filter((x) => !x.includes('حساب') && !x.includes('تفويض') && !x.includes('المستفيد')) }));
    if (calc.length) throw new BadRequestException({ message: 'حالاتٌ لم تكتمل مراجعتها — لا تُقدَّم للاعتماد', entries: calc });
    const hash = hashOf(snap);
    const totals: Record<string, any> = {};
    for (const e of snap.entries) {
      const t = (totals[e.currency] ||= { count: 0, payable: 0, balance: '0.00', payable_balance: '0.00' });
      t.count++; t.balance = new Decimal(t.balance).plus(e.result.balance).toFixed(2);
      if (e.payable) { t.payable++; t.payable_balance = new Decimal(t.payable_balance).plus(e.result.balance).toFixed(2); }
    }
    return this.ds.transaction(async (m) => {
      const vr = m.getRepository(CrewSalaryVersion);
      const last = await vr.findOne({ where: { cycle_id: cycleId }, order: { version_no: 'DESC' } });
      if (last && last.content_hash === hash && ['submitted', 'approved'].includes(last.status)) {
        throw new ConflictException(`الإصدار ${last.version_no} بالمحتوى نفسه ${last.status === 'approved' ? 'معتمدٌ' : 'مقدَّمٌ'} سلفاً`);
      }
      await vr.createQueryBuilder().update().set({ status: 'superseded' }).where('cycle_id = :c AND status = :s', { c: cycleId, s: 'submitted' }).execute();
      const v = await vr.save(vr.create({
        cycle_id: cycleId, version_no: (last?.version_no || 0) + 1, status: 'submitted', snapshot: snap, totals, fx_snapshot: snap.fx,
        content_hash: hash, submitted_by: a.id || null, submitted_by_name: nameOf(a), submit_reason: r,
      }));
      await m.getRepository(CrewSalaryCycle).update({ id: cycleId }, { status: 'submitted', current_version: v.version_no, updated_at: new Date() });
      await this.audit(m, a, 'submitted', 'version', v.id, cycleId, r, { version_no: v.version_no, content_hash: hash, totals });
      return { id: v.id, version_no: v.version_no, totals };
    });
  }

  static entitlementKey(snap: Snapshot, e: SnapshotEntry, it: SnapshotEntry['result']['items'][number]) {
    const base = `${e.crew_id}|${e.currency}|${it.kind}`;
    if ((RATE_KINDS as readonly string[]).includes(it.kind)) return `${base}|${e.result.service.start}|${e.result.service.end}`;
    if (it.kind === 'sign_off_day') return `${base}|${e.result.service.end}`;
    return `${base}|${snap.cycle.month}|${it.key}`;
  }

  async approve(versionId: string, reason: string, a: Actor) {
    this.assertApprover(a);
    const r = need(reason, 'ملاحظة الاعتماد');
    const v = await this.ds.getRepository(CrewSalaryVersion).findOne({ where: { id: versionId } });
    if (!v) throw new NotFoundException('الإصدار غير موجود');
    if (v.status !== 'submitted') throw new ConflictException('الإصدار ليس مقدَّماً للاعتماد');
    const latest = await this.ds.getRepository(CrewSalaryVersion).findOne({ where: { cycle_id: v.cycle_id }, order: { version_no: 'DESC' } });
    if (latest?.id !== v.id) throw new ConflictException('يوجد إصدارٌ أحدث — اعتمد الأحدث');
    const { snap } = await this.snapshot(v.cycle_id);
    if (hashOf(snap) !== v.content_hash) throw new ConflictException('تغيّرت البيانات بعد التقديم — أعِد التقديم بإصدارٍ جديد');
    const s: Snapshot = v.snapshot;

    return this.ds.transaction(async (m) => {
      const er = m.getRepository(CrewSalaryEntitlement);
      const cycle = await m.getRepository(CrewSalaryCycle).findOne({ where: { id: v.cycle_id } });
      // الإصدار المعتمد السابق للدورة نفسها يُستبدل: تُطفأ استحقاقاته أوّلاً
      if (cycle?.approved_version_id) {
        await er.update({ version_id: cycle.approved_version_id, active: true }, { active: false });
        await m.getRepository(CrewSalaryVersion).update({ id: cycle.approved_version_id }, { status: 'superseded' });
      }
      const rows: Partial<CrewSalaryEntitlement>[] = [];
      for (const e of s.entries) {
        for (const it of e.result.items) {
          if (!it.counted || it.amount == null) continue;
          rows.push({
            version_id: v.id, cycle_id: v.cycle_id, crew_id: e.crew_id, currency: e.currency, kind: it.kind,
            period_start: e.result.service.start, period_end: e.result.service.end, amount: it.amount,
            entitlement_key: CrewSalariesService.entitlementKey(s, e, it), active: true,
          });
        }
      }
      // تداخل فترات الخدمة مع استحقاقٍ معتمدٍ في دورةٍ أخرى (مركبٌ آخر أو إصدارٌ آخر)
      const conflicts: string[] = [];
      for (const x of rows.filter((x) => (RATE_KINDS as readonly string[]).includes(x.kind!) && x.period_start && x.period_end)) {
        const hit = await er.createQueryBuilder('t')
          .where('t.active AND t.crew_id = :c AND t.kind = :k AND t.cycle_id <> :cy', { c: x.crew_id, k: x.kind, cy: v.cycle_id })
          .andWhere('t.period_start <= :e AND t.period_end >= :s', { s: x.period_start, e: x.period_end }).getOne();
        if (hit) conflicts.push(`${x.crew_id} ${x.kind} ${x.period_start}→${x.period_end} يتداخل مع استحقاقٍ معتمد ${hit.period_start}→${hit.period_end}`);
      }
      if (conflicts.length) throw new ConflictException({ message: 'استحقاقٌ مكرَّر — لا يُعتمد', conflicts });
      try {
        if (rows.length) await er.insert(rows);
      } catch (err: any) {
        if (err?.code === '23505') throw new ConflictException({ message: 'استحقاقٌ معتمدٌ من قبل — لا يُعتمد مرّتين', detail: String(err.detail || '').slice(0, 300) });
        throw err;
      }
      await m.getRepository(CrewSalaryVersion).update({ id: v.id }, { status: 'approved', decided_by: a.id, decided_by_name: nameOf(a), decided_at: new Date(), decision_reason: r });
      await m.getRepository(CrewSalaryCycle).update({ id: v.cycle_id }, { status: 'approved', approved_version_id: v.id, updated_at: new Date() });
      await this.audit(m, a, 'approved', 'version', v.id, v.cycle_id, r, { version_no: v.version_no, content_hash: v.content_hash, entitlements: rows.length, replaced: cycle?.approved_version_id ?? null });
      return { ok: true, version_no: v.version_no, entitlements: rows.length };
    });
  }

  async reject(versionId: string, reason: string, a: Actor) {
    this.assertApprover(a);
    const r = need(reason, 'سبب الرفض');
    return this.ds.transaction(async (m) => {
      const v = await m.getRepository(CrewSalaryVersion).findOne({ where: { id: versionId } });
      if (!v) throw new NotFoundException('الإصدار غير موجود');
      if (v.status !== 'submitted') throw new ConflictException('الإصدار ليس مقدَّماً للاعتماد');
      await m.getRepository(CrewSalaryVersion).update({ id: v.id }, { status: 'rejected', decided_by: a.id, decided_by_name: nameOf(a), decided_at: new Date(), decision_reason: r });
      const c = await m.getRepository(CrewSalaryCycle).findOne({ where: { id: v.cycle_id } });
      await m.getRepository(CrewSalaryCycle).update({ id: v.cycle_id }, { status: c?.approved_version_id ? 'approved' : 'draft', updated_at: new Date() });
      await this.audit(m, a, 'rejected', 'version', v.id, v.cycle_id, r, { version_no: v.version_no });
      return { ok: true };
    });
  }

  // ══════════════════════════ التصدير ══════════════════════════
  async exportReview(cycleId: string, a: Actor) {
    const { snap, build: b } = await this.snapshot(cycleId);
    const now = new Date().toISOString();
    const buffer = buildReviewWorkbook(snap, { exported_at: now, status: b.cycle.status, version_no: b.cycle.current_version || null });
    const batch = `REV-${vesselSlug(b.cycle.vessel)}-${b.cycle.month.replace('-', '')}-${now.slice(0, 19).replace(/\D/g, '')}`;
    await this.ds.transaction(async (m) => {
      await m.getRepository(CrewSalaryExport).insert({ cycle_id: cycleId, version_id: null, kind: 'review', batch_no: batch, currency: null, file_sha256: sha256(buffer), row_count: snap.entries.length, exported_by: a.id || null, exported_by_name: nameOf(a) });
      await this.audit(m, a, 'export_review', 'export', batch, cycleId, '', { entries: snap.entries.length });
    });
    return { buffer, filename: `${batch}.xlsx` };
  }

  async exportPayments(cycleId: string, currency: string, a: Actor) {
    const cur = String(currency || '').toUpperCase();
    if (!/^[A-Z]{3}$/.test(cur)) throw new BadRequestException('العملة مطلوبة');
    const cycle = await this.cycleOr404(cycleId);
    if (!cycle.approved_version_id) throw new BadRequestException('لا إصدار معتمد لهذه الدورة — كشف الصرف من إصدارٍ معتمدٍ وحده');
    const v = await this.ds.getRepository(CrewSalaryVersion).findOne({ where: { id: cycle.approved_version_id } });
    if (!v || v.status !== 'approved') throw new ConflictException('الإصدار المعتمد غير صالح');
    const s: Snapshot = v.snapshot;
    const { included } = payableEntries(s, cur);
    if (!included.length) throw new BadRequestException(`لا حالات مكتملة بعملة ${cur} في الإصدار المعتمد`);
    const batch = `CS-${vesselSlug(cycle.vessel)}-${cycle.month.replace('-', '')}-V${v.version_no}-${cur}`;
    const prior = await this.ds.getRepository(CrewSalaryExport).findOne({ where: { cycle_id: cycleId, version_id: v.id, kind: 'approved_payments', currency: cur }, order: { exported_at: 'ASC' } });
    const exportedAt = (prior?.exported_at || new Date()).toISOString();
    const out = buildPaymentsWorkbook(s, {
      batch_no: batch, currency: cur, exported_at: exportedAt, version_no: v.version_no,
      approved_by: v.decided_by_name, approved_at: v.decided_at ? v.decided_at.toISOString() : '',
    });
    await this.ds.transaction(async (m) => {
      await m.getRepository(CrewSalaryExport).insert({
        cycle_id: cycleId, version_id: v.id, kind: 'approved_payments', batch_no: batch, currency: cur, file_sha256: sha256(out.buffer),
        row_count: out.rows, is_redownload: !!prior, exported_by: a.id || null, exported_by_name: nameOf(a),
      });
      if (!prior && cycle.status === 'approved') await m.getRepository(CrewSalaryCycle).update({ id: cycleId }, { status: 'exported', updated_at: new Date() });
      await this.audit(m, a, prior ? 'export_payments_redownload' : 'export_payments', 'export', batch, cycleId, '', { version_no: v.version_no, currency: cur, rows: out.rows, total: out.total });
    });
    return { buffer: out.buffer, filename: `${batch}.xlsx`, redownload: !!prior };
  }
}

export type { ExtraItemInput };
