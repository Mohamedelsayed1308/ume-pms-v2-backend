import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { createHash } from 'crypto';
import {
  BATCH_CODE, BATCH_DESCRIPTION, BATCH_CLASSIFICATION_REASON, BATCH_NOTES, BATCH_INSERT,
  LEGACY_RECORDS, MANIFEST_RECORDS_SHA256, EXPECTED_COUNT, EXPECTED_PRE_SYSTEM_SETTLED,
  EXPECTED_CREDIT_NOTE, R1_SIGNATURE, SCHEMA_UP, STAGING_CREATE, TAG_UPDATE,
} from './r3a-legacy-2026-08';

/** يُرمى عمداً لإجهاض معاملة التشغيل التجريبي — لا يمثّل خطأً. */
class DryRunRollback extends Error {
  constructor(public readonly report: any) { super('DRY_RUN_ROLLBACK'); }
}

const r2 = (n: any) => Math.round((Number(n) || 0) * 100) / 100;

@Injectable()
export class R3aRunnerService {
  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  /**
   * هجرة R3A — مخطط + دفعة + توسيم 128 سجلاً، داخل معاملة واحدة.
   * Postgres يدعم DDL معامَلاتياً، فإخفاق أي بوابة يتراجع بالكامل ولا يترك حالة نصفية.
   * متكرّرة الأمان: التشغيل الثاني يعدّل صفر صف ولا يُنشئ دفعة ثانية.
   */
  async run(dryRun: boolean) {
    // ── بوابة 0 · نزاهة البيان المضمَّن (قبل فتح أي معاملة) ──
    const embeddedHash = createHash('sha256')
      .update(JSON.stringify(LEGACY_RECORDS.map((r) => ({
        invoice_id: r.invoice_id, invoice_number: r.invoice_number, supplier: r.supplier,
        currency: r.currency, amount: r.amount, settlement_basis: r.settlement_basis,
      }))), 'utf8').digest('hex');
    if (embeddedHash !== MANIFEST_RECORDS_SHA256) {
      throw new BadRequestException(`ABORT: بصمة البيان المضمَّن ${embeddedHash} ≠ المعتمدة`);
    }
    if (LEGACY_RECORDS.length !== EXPECTED_COUNT) throw new BadRequestException('ABORT: عدد السجلات');
    const pss = LEGACY_RECORDS.filter((r) => r.settlement_basis === 'pre_system_settled').length;
    const cn = LEGACY_RECORDS.filter((r) => r.settlement_basis === 'credit_note').length;
    if (pss !== EXPECTED_PRE_SYSTEM_SETTLED || cn !== EXPECTED_CREDIT_NOTE) {
      throw new BadRequestException(`ABORT: التصنيف ${pss}/${cn}`);
    }
    if (new Set(LEGACY_RECORDS.map((r) => r.invoice_id)).size !== EXPECTED_COUNT) {
      throw new BadRequestException('ABORT: معرّفات مكرّرة');
    }

    try {
      return await this.ds.transaction(async (m) => {
        const report: any = { dryRun, batchCode: BATCH_CODE, manifestHash: embeddedHash, gates: {}, steps: [] };

        // ── البصمة المالية قبل أي كتابة ──
        report.fingerprintBefore = await this.fingerprint(m);
        report.paymentsBefore = Number((await m.query('SELECT COUNT(*)::int AS n FROM payments'))[0].n);

        // ── لقطة التعافي: الحالة الكاملة للـ128 قبل التعديل ──
        report.snapshot = await m.query(
          `SELECT id AS invoice_id, invoice_number, status::text AS status,
                  approval_status, paid_amount::text, total_amount::text, currency,
                  supplier_id, vessel_id
             FROM invoices WHERE id = ANY($1::uuid[]) ORDER BY id`,
          [LEGACY_RECORDS.map((r) => r.invoice_id)],
        );
        if (report.snapshot.length !== EXPECTED_COUNT) {
          throw new BadRequestException(`ABORT: اللقطة ${report.snapshot.length} ≠ ${EXPECTED_COUNT} — معرّفات مفقودة`);
        }

        // ── STEP A · المخطط ──
        for (const sql of SCHEMA_UP) await m.query(sql);
        report.steps.push('schema');

        // ── STEP B · الدفعة ──
        await m.query(BATCH_INSERT, [BATCH_CODE, BATCH_DESCRIPTION, BATCH_CLASSIFICATION_REASON, BATCH_NOTES]);
        const batch = await m.query('SELECT id FROM import_batches WHERE batch_code = $1', [BATCH_CODE]);
        if (batch.length !== 1) throw new BadRequestException('ABORT: الدفعة غير فريدة');
        const batchId = batch[0].id;
        report.batchId = batchId;
        report.steps.push('batch');

        // ── STEP C · جدول staging مشتق حرفياً من البيان ──
        await m.query(STAGING_CREATE);
        for (const r of LEGACY_RECORDS) {
          await m.query(
            'INSERT INTO r3a_staging (invoice_id, invoice_number, currency, amount, settlement_basis) VALUES ($1,$2,$3,$4,$5)',
            [r.invoice_id, r.invoice_number, r.currency, r.amount, r.settlement_basis],
          );
        }
        const staged = Number((await m.query('SELECT COUNT(*)::int AS n FROM r3a_staging'))[0].n);
        if (staged !== EXPECTED_COUNT) throw new BadRequestException(`ABORT: staging ${staged}`);
        report.steps.push('staging');

        // ── البوابات ──
        const g = report.gates;

        g.missingIds = Number((await m.query(
          `SELECT COUNT(*)::int AS n FROM r3a_staging s
            WHERE NOT EXISTS (SELECT 1 FROM invoices i WHERE i.id = s.invoice_id)`))[0].n);
        if (g.missingIds !== 0) throw new BadRequestException(`ABORT: ${g.missingIds} معرّف غير موجود`);

        g.withPayments = await m.query(
          `SELECT s.invoice_number FROM r3a_staging s
            WHERE EXISTS (SELECT 1 FROM payments p WHERE p.invoice_id = s.invoice_id)`);
        if (g.withPayments.length) {
          throw new BadRequestException(`ABORT: سداد فعلي على ${g.withPayments.map((x: any) => x.invoice_number).join(', ')}`);
        }

        g.fieldMismatches = await m.query(
          `SELECT s.invoice_number AS manifest_number, i.invoice_number AS live_number,
                  s.currency AS manifest_ccy, i.currency AS live_ccy,
                  s.amount::text AS manifest_amount, i.total_amount::text AS live_amount
             FROM r3a_staging s JOIN invoices i ON i.id = s.invoice_id
            WHERE i.invoice_number <> s.invoice_number
               OR UPPER(TRIM(i.currency)) <> s.currency
               OR i.total_amount <> s.amount`);
        if (g.fieldMismatches.length) {
          throw new BadRequestException(`ABORT: ${g.fieldMismatches.length} فاتورة انحرفت عن البيان`);
        }

        const sig = await m.query(
          `SELECT UPPER(TRIM(i.currency)) AS currency, SUM(ABS(i.paid_amount))::text AS abs_paid
             FROM r3a_staging s JOIN invoices i ON i.id = s.invoice_id
            GROUP BY 1 ORDER BY 1`);
        g.signature = sig.reduce((a: any, x: any) => { a[x.currency] = r2(x.abs_paid); return a; }, {});
        g.signatureMatch = Object.keys(R1_SIGNATURE).length === Object.keys(g.signature).length
          && Object.entries(R1_SIGNATURE).every(([c, v]) => g.signature[c] === v);
        if (!g.signatureMatch) throw new BadRequestException(`ABORT: بصمة R1 غير مطابقة ${JSON.stringify(g.signature)}`);

        // ── STEP D · التوسيم ──
        const tagged = await m.query(TAG_UPDATE, [batchId]);
        report.taggedNow = tagged.length;   // 0 عند إعادة التشغيل — متكرّرة الأمان
        report.steps.push('tagging');

        // ── التحقق اللاحق ──
        const v: any = {};
        v.inBatch = Number((await m.query(
          'SELECT COUNT(*)::int AS n FROM invoices WHERE import_batch_id = $1', [batchId]))[0].n);
        v.preSystemSettled = Number((await m.query(
          `SELECT COUNT(*)::int AS n FROM invoices WHERE import_batch_id = $1
             AND settlement_basis = 'pre_system_settled'`, [batchId]))[0].n);
        v.creditNote = Number((await m.query(
          `SELECT COUNT(*)::int AS n FROM invoices WHERE import_batch_id = $1
             AND settlement_basis = 'credit_note'`, [batchId]))[0].n);
        v.migratedOutsideManifest = Number((await m.query(
          `SELECT COUNT(*)::int AS n FROM invoices i
            WHERE i.data_origin = 'migrated'
              AND NOT EXISTS (SELECT 1 FROM r3a_staging s WHERE s.invoice_id = i.id)`))[0].n);
        v.presystemWithoutBatch = Number((await m.query(
          `SELECT COUNT(*)::int AS n FROM invoices
            WHERE settlement_basis = 'pre_system_settled' AND import_batch_id IS NULL`))[0].n);
        v.presystemWithPayments = Number((await m.query(
          `SELECT COUNT(*)::int AS n FROM invoices i
            WHERE i.settlement_basis = 'pre_system_settled'
              AND EXISTS (SELECT 1 FROM payments p WHERE p.invoice_id = i.id)`))[0].n);
        v.manifestMatchAfter = Number((await m.query(
          `SELECT COUNT(*)::int AS n FROM r3a_staging s JOIN invoices i ON i.id = s.invoice_id
            WHERE i.invoice_number = s.invoice_number
              AND UPPER(TRIM(i.currency)) = s.currency
              AND i.total_amount = s.amount
              AND i.settlement_basis = s.settlement_basis
              AND i.data_origin = 'migrated'
              AND i.import_batch_id = $1`, [batchId]))[0].n);
        report.validation = v;

        if (v.inBatch !== EXPECTED_COUNT) throw new BadRequestException(`ABORT: الموسوم ${v.inBatch}`);
        if (v.preSystemSettled !== EXPECTED_PRE_SYSTEM_SETTLED) throw new BadRequestException(`ABORT: pss ${v.preSystemSettled}`);
        if (v.creditNote !== EXPECTED_CREDIT_NOTE) throw new BadRequestException(`ABORT: cn ${v.creditNote}`);
        if (v.migratedOutsideManifest !== 0) throw new BadRequestException(`ABORT: ${v.migratedOutsideManifest} صف خارج البيان وُسم`);
        if (v.presystemWithoutBatch !== 0) throw new BadRequestException('ABORT: تسوية بلا دفعة');
        if (v.presystemWithPayments !== 0) throw new BadRequestException('ABORT: تسوية على فاتورة لها سداد');
        if (v.manifestMatchAfter !== EXPECTED_COUNT) throw new BadRequestException(`ABORT: مطابقة البيان ${v.manifestMatchAfter}`);

        // ── البرهان الحاسم: لم يتغيّر أي رقم مالي ──
        report.fingerprintAfter = await this.fingerprint(m);
        report.paymentsAfter = Number((await m.query('SELECT COUNT(*)::int AS n FROM payments'))[0].n);
        report.financialFingerprintUnchanged =
          JSON.stringify(report.fingerprintBefore) === JSON.stringify(report.fingerprintAfter);
        report.paymentsUnchanged = report.paymentsBefore === report.paymentsAfter;
        if (!report.financialFingerprintUnchanged) throw new BadRequestException('ABORT: تغيّرت البصمة المالية');
        if (!report.paymentsUnchanged) throw new BadRequestException('ABORT: تغيّر عدد السدادات');

        // ── حالة كائنات المخطط (تحقّق من بقاء القيود) ──
        report.constraints = await m.query(
          `SELECT c.conname, pg_get_constraintdef(c.oid) AS def
             FROM pg_constraint c JOIN pg_class r ON r.oid = c.conrelid
            WHERE r.relname = 'invoices' AND c.conname LIKE ANY (ARRAY['chk_inv_%','fk_invoices_import_batch'])
            ORDER BY c.conname`);

        if (dryRun) throw new DryRunRollback(report);
        report.committed = true;
        return report;
      });
    } catch (e) {
      if (e instanceof DryRunRollback) {
        return { ...e.report, committed: false, note: 'تشغيل تجريبي — تراجعت المعاملة بالكامل، لم يُكتب شيء' };
      }
      throw e;
    }
  }

  /** بصمة مالية كاملة: أي تغيّر في أي مبلغ أو حالة يظهر هنا. */
  private fingerprint(m: EntityManager) {
    return m.query(
      `SELECT status::text AS status, UPPER(TRIM(currency)) AS currency, COUNT(*)::int AS n,
              SUM(total_amount)::text AS total, SUM(paid_amount)::text AS paid,
              SUM(total_amount - paid_amount)::text AS outstanding
         FROM invoices GROUP BY 1,2 ORDER BY 1,2`);
  }

  /** تراجع كامل — لا يحتاج اختراع بيانات: الأعمدة جديدة وقيمها السابقة هي الافتراضيات. */
  async rollback() {
    return this.ds.transaction(async (m) => {
      const batch = await m.query('SELECT id FROM import_batches WHERE batch_code = $1', [BATCH_CODE]);
      if (!batch.length) return { reverted: 0, batchDeleted: false, note: 'لا دفعة — لا شيء للتراجع عنه' };
      const reverted = await m.query(
        `UPDATE invoices SET data_origin = 'operational', settlement_basis = 'none', import_batch_id = NULL
          WHERE import_batch_id = $1 RETURNING id`, [batch[0].id]);
      await m.query('DELETE FROM import_batches WHERE batch_code = $1', [BATCH_CODE]);
      return { reverted: reverted.length, batchDeleted: true };
    });
  }
}
