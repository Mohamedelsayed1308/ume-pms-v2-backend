import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * كيانات مرتّبات الأطقم — مرآة `docs/crew-salaries-up.sql` حرفاً بحرف.
 * الإنتاج لا يُزامَن: كلّ عمودٍ هنا يلزمه سطرٌ في الهجرة (اختبار التطابق يفحص ذلك
 * على PostgreSQL حقيقيّة). ولا مفاتيح أجنبيّة إلى `users` — المعرّف ولقطة الاسم.
 */

@Entity('crew_salary_cycles')
@Index('UQ_crew_salary_cycles_vessel_month', ['vessel', 'month'], { unique: true })
export class CrewSalaryCycle {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'varchar', length: 120 }) vessel: string;
  @Column({ type: 'varchar', length: 7 }) month: string;
  @Column({ type: 'varchar', length: 20, default: 'draft' }) status: string;
  @Column({ type: 'integer', default: 0 }) current_version: number;
  @Column({ type: 'uuid', nullable: true }) approved_version_id: string | null;
  @Column({ type: 'uuid', nullable: true }) created_by: string | null;
  @Column({ type: 'timestamptz', default: () => 'now()' }) created_at: Date;
  @Column({ type: 'timestamptz', default: () => 'now()' }) updated_at: Date;
}

@Entity('crew_salary_files')
@Index('UQ_crew_salary_files_top_sha', ['sha256'], { unique: true, where: 'parent_id IS NULL' })
@Index('UQ_crew_salary_files_parent_pos', ['parent_id', 'position'], { unique: true, where: 'parent_id IS NOT NULL' })
@Index('IDX_crew_salary_files_cycle', ['cycle_id'])
export class CrewSalaryFile {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'uuid', nullable: true }) cycle_id: string | null;
  @Column({ type: 'uuid', nullable: true }) parent_id: string | null;
  @Column({ type: 'integer', nullable: true }) position: number | null;
  @Column({ type: 'varchar', length: 30 }) kind: string;
  @Column({ type: 'varchar', length: 255 }) name: string;
  @Column({ type: 'varchar', length: 12, default: '' }) ext: string;
  @Column({ type: 'varchar', length: 100, nullable: true }) mime: string | null;
  @Column({ type: 'integer', default: 0 }) size: number;
  @Column({ type: 'varchar', length: 64 }) sha256: string;
  // المحتوى لا يُحمَّل مع القوائم — يُطلب صراحةً
  @Column({ type: 'bytea', nullable: true, select: false }) content: Buffer | null;
  @Column({ type: 'varchar', length: 30, default: 'unsupported' }) class: string;
  @Column({ type: 'varchar', length: 20, default: 'stored' }) status: string;
  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" }) flags: string[];
  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" }) meta: Record<string, any>;
  @Column({ type: 'jsonb', nullable: true, select: false }) parsed: any;
  @Column({ type: 'uuid', nullable: true }) supersedes_id: string | null;
  @Column({ type: 'uuid', nullable: true }) uploaded_by: string | null;
  @Column({ type: 'timestamptz', default: () => 'now()' }) uploaded_at: Date;
}

@Entity('crew_salary_decisions')
@Index('UQ_crew_salary_decisions_live', ['cycle_id', 'kind', 'target_key'], { unique: true, where: 'superseded_at IS NULL' })
export class CrewSalaryDecision {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'uuid' }) cycle_id: string;
  @Column({ type: 'varchar', length: 30 }) kind: string;
  @Column({ type: 'varchar', length: 300 }) target_key: string;
  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" }) value: any;
  @Column({ type: 'text', default: '' }) reason: string;
  @Column({ type: 'uuid', nullable: true }) decided_by: string | null;
  @Column({ type: 'varchar', length: 150, default: '' }) decided_by_name: string;
  @Column({ type: 'timestamptz', default: () => 'now()' }) decided_at: Date;
  @Column({ type: 'timestamptz', nullable: true }) superseded_at: Date | null;
}

@Entity('crew_salary_links')
@Index('UQ_crew_salary_links_live', ['source_key'], { unique: true, where: 'revoked_at IS NULL' })
export class CrewSalaryLink {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'varchar', length: 300 }) source_key: string;
  @Column({ type: 'varchar', length: 40 }) crew_id: string;
  @Column({ type: 'uuid', nullable: true }) confirmed_by: string | null;
  @Column({ type: 'varchar', length: 150, default: '' }) confirmed_by_name: string;
  @Column({ type: 'timestamptz', default: () => 'now()' }) confirmed_at: Date;
  @Column({ type: 'timestamptz', nullable: true }) revoked_at: Date | null;
}

@Entity('crew_salary_authorizations')
@Index('IDX_crew_salary_authorizations_crew', ['crew_id'])
export class CrewSalaryAuthorization {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'varchar', length: 40 }) crew_id: string;
  @Column({ type: 'varchar', length: 200 }) beneficiary: string;
  @Column({ type: 'varchar', length: 120, default: '' }) relation: string;
  @Column({ type: 'uuid', nullable: true }) document_file_id: string | null;
  @Column({ type: 'date', nullable: true }) valid_from: string | null;
  @Column({ type: 'date', nullable: true }) valid_to: string | null;
  @Column({ type: 'varchar', length: 20, default: 'pending' }) status: string;
  @Column({ type: 'text', default: '' }) note: string;
  @Column({ type: 'uuid', nullable: true }) created_by: string | null;
  @Column({ type: 'timestamptz', default: () => 'now()' }) created_at: Date;
  @Column({ type: 'uuid', nullable: true }) reviewed_by: string | null;
  @Column({ type: 'varchar', length: 150, default: '' }) reviewed_by_name: string;
  @Column({ type: 'timestamptz', nullable: true }) reviewed_at: Date | null;
  @Column({ type: 'text', default: '' }) review_reason: string;
}

@Entity('crew_salary_bank_accounts')
@Index('UQ_crew_salary_bank_accounts_fp', ['crew_id', 'fingerprint'], { unique: true })
@Index('UQ_crew_salary_bank_accounts_approved', ['crew_id'], { unique: true, where: "status = 'approved'" })
export class CrewSalaryBankAccount {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'varchar', length: 40 }) crew_id: string;
  @Column({ type: 'varchar', length: 200, default: '' }) beneficiary: string;
  @Column({ type: 'boolean', nullable: true }) beneficiary_is_seafarer: boolean | null;
  @Column({ type: 'varchar', length: 200, default: '' }) bank: string;
  @Column({ type: 'varchar', length: 200, default: '' }) branch: string;
  @Column({ type: 'varchar', length: 80, default: '' }) country: string;
  @Column({ type: 'varchar', length: 64, default: '' }) iban: string;
  @Column({ type: 'varchar', length: 64, default: '' }) account_number: string;
  @Column({ type: 'varchar', length: 20, default: '' }) swift: string;
  @Column({ type: 'varchar', length: 40, default: '' }) bank_code: string;
  @Column({ type: 'varchar', length: 3, nullable: true }) account_currency: string | null;
  @Column({ type: 'varchar', length: 30, default: 'manual' }) source: string;
  @Column({ type: 'uuid', nullable: true }) source_file_id: string | null;
  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" }) provenance: any;
  @Column({ type: 'varchar', length: 64 }) fingerprint: string;
  @Column({ type: 'varchar', length: 20, default: 'imported' }) status: string;
  @Column({ type: 'uuid', nullable: true }) authorization_id: string | null;
  @Column({ type: 'uuid', nullable: true }) reviewed_by: string | null;
  @Column({ type: 'varchar', length: 150, default: '' }) reviewed_by_name: string;
  @Column({ type: 'timestamptz', nullable: true }) reviewed_at: Date | null;
  @Column({ type: 'text', default: '' }) review_reason: string;
  @Column({ type: 'uuid', nullable: true }) created_by: string | null;
  @CreateDateColumn({ type: 'timestamptz' }) created_at: Date;
}

@Entity('crew_salary_versions')
@Index('UQ_crew_salary_versions_no', ['cycle_id', 'version_no'], { unique: true })
export class CrewSalaryVersion {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'uuid' }) cycle_id: string;
  @Column({ type: 'integer' }) version_no: number;
  @Column({ type: 'varchar', length: 20, default: 'submitted' }) status: string;
  @Column({ type: 'jsonb' }) snapshot: any;
  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" }) totals: any;
  @Column({ type: 'jsonb', nullable: true }) fx_snapshot: any;
  @Column({ type: 'varchar', length: 64 }) content_hash: string;
  @Column({ type: 'uuid', nullable: true }) submitted_by: string | null;
  @Column({ type: 'varchar', length: 150, default: '' }) submitted_by_name: string;
  @Column({ type: 'timestamptz', default: () => 'now()' }) submitted_at: Date;
  @Column({ type: 'text', default: '' }) submit_reason: string;
  @Column({ type: 'uuid', nullable: true }) decided_by: string | null;
  @Column({ type: 'varchar', length: 150, default: '' }) decided_by_name: string;
  @Column({ type: 'timestamptz', nullable: true }) decided_at: Date | null;
  @Column({ type: 'text', default: '' }) decision_reason: string;
}

@Entity('crew_salary_entitlements')
@Index('UQ_crew_salary_entitlements_active', ['entitlement_key'], { unique: true, where: 'active' })
@Index('IDX_crew_salary_entitlements_crew', ['crew_id'])
@Index('IDX_crew_salary_entitlements_entry', ['cycle_id', 'entry_key'], { where: 'active' })
export class CrewSalaryEntitlement {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'uuid' }) version_id: string;
  @Column({ type: 'uuid' }) cycle_id: string;
  @Column({ type: 'varchar', length: 40 }) crew_id: string;
  @Column({ type: 'varchar', length: 3 }) currency: string;
  @Column({ type: 'varchar', length: 30 }) kind: string;
  @Column({ type: 'date', nullable: true }) period_start: string | null;
  @Column({ type: 'date', nullable: true }) period_end: string | null;
  @Column({ type: 'numeric', precision: 14, scale: 2 }) amount: string;
  @Column({ type: 'varchar', length: 80 }) entry_key: string;
  @Column({ type: 'varchar', length: 300 }) entitlement_key: string;
  @Column({ type: 'boolean', default: true }) active: boolean;
  @CreateDateColumn({ type: 'timestamptz' }) created_at: Date;
}

@Entity('crew_salary_exports')
@Index('IDX_crew_salary_exports_cycle', ['cycle_id'])
export class CrewSalaryExport {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'uuid' }) cycle_id: string;
  @Column({ type: 'uuid', nullable: true }) version_id: string | null;
  @Column({ type: 'varchar', length: 30 }) kind: string;
  @Column({ type: 'varchar', length: 40 }) batch_no: string;
  @Column({ type: 'varchar', length: 3, nullable: true }) currency: string | null;
  @Column({ type: 'varchar', length: 64 }) file_sha256: string;
  @Column({ type: 'integer', default: 0 }) row_count: number;
  @Column({ type: 'boolean', default: false }) is_redownload: boolean;
  // الملفّ كما صدر أوّل مرّة — إعادة التنزيل تعيده حرفيّاً
  @Column({ type: 'bytea', nullable: true, select: false }) content: Buffer | null;
  @Column({ type: 'uuid', nullable: true }) exported_by: string | null;
  @Column({ type: 'varchar', length: 150, default: '' }) exported_by_name: string;
  @Column({ type: 'timestamptz', default: () => 'now()' }) exported_at: Date;
}

/**
 * ما خرج فعلاً في دفعةٍ بعينها — صفّاً صفّاً. عضويّة الدفعة من هنا لا من لقطة الإصدار.
 * «خرج» ليس «صُرف»: الحالة التي تتغيّر بعد خروجها تنتظر قرار المالك (استبدال · تسوية · إبقاء).
 */
@Entity('crew_salary_export_rows')
@Index('IDX_crew_salary_export_rows_export', ['export_id'])
@Index('IDX_crew_salary_export_rows_entry', ['cycle_id', 'entry_key'], { where: "status = 'active'" })
export class CrewSalaryExportRow {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'uuid' }) export_id: string;
  @Column({ type: 'uuid' }) cycle_id: string;
  @Column({ type: 'uuid' }) version_id: string;
  @Column({ type: 'varchar', length: 80 }) entry_key: string;
  @Column({ type: 'varchar', length: 40 }) crew_id: string;
  @Column({ type: 'varchar', length: 3 }) currency: string;
  @Column({ type: 'varchar', length: 64 }) entry_hash: string;
  @Column({ type: 'uuid', nullable: true }) bank_id: string | null;
  @Column({ type: 'numeric', precision: 14, scale: 2 }) balance: string;    // الصافي المعتمد وقت الخروج
  @Column({ type: 'numeric', precision: 14, scale: 2 }) amount: string;     // ما خرج في هذه الدفعة
  @Column({ type: 'varchar', length: 20 }) row_kind: 'full' | 'settlement';
  @Column({ type: 'uuid', nullable: true }) resolution_id: string | null;   // قرار المالك الذي أجازه
  @Column({ type: 'varchar', length: 20, default: 'active' }) status: 'active' | 'replaced';
  @Column({ type: 'uuid', nullable: true }) replaced_by: string | null;
  @Column({ type: 'timestamptz', nullable: true }) replaced_at: Date | null;
  @Column({ type: 'timestamptz', default: () => 'clock_timestamp()' }) created_at: Date;
}

@Entity('crew_salary_audit')
@Index('IDX_crew_salary_audit_cycle', ['cycle_id', 'occurred_at'])
export class CrewSalaryAudit {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'uuid', nullable: true }) cycle_id: string | null;
  @Column({ type: 'varchar', length: 40 }) entity: string;
  @Column({ type: 'varchar', length: 80, default: '' }) entity_id: string;
  @Column({ type: 'varchar', length: 40 }) action: string;
  @Column({ type: 'uuid', nullable: true }) user_id: string | null;
  @Column({ type: 'varchar', length: 255, default: '' }) user_email: string;
  @Column({ type: 'varchar', length: 150, default: '' }) user_name: string;
  @Column({ type: 'text', default: '' }) reason: string;
  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" }) details: any;
  @Column({ type: 'timestamptz', default: () => 'now()' }) occurred_at: Date;
}

export const CREW_SALARY_ENTITIES = [
  CrewSalaryCycle, CrewSalaryFile, CrewSalaryDecision, CrewSalaryLink, CrewSalaryAuthorization,
  CrewSalaryBankAccount, CrewSalaryVersion, CrewSalaryEntitlement, CrewSalaryExport, CrewSalaryExportRow, CrewSalaryAudit,
];
