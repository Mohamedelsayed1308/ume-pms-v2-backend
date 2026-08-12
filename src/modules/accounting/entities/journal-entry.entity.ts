import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne, OneToMany, JoinColumn, Index, Check } from 'typeorm';
import { LegalEntity } from './legal-entity.entity';
import { Journal } from './journal.entity';
import { FiscalYear } from './fiscal-year.entity';
import { FiscalPeriod } from './fiscal-period.entity';
import { JournalLine } from './journal-line.entity';
import {
  FK_JE_ENTITY, FK_JE_JOURNAL, FK_JE_FY, FK_JE_PERIOD,
  FK_JE_REVERSAL_OF, FK_JE_REVERSED_BY,
  UQ_JE_ENTRY_NO, UQ_JE_EVENT, IDX_JE_PERIOD, IDX_JE_SOURCE, IDX_JE_BACKDATED,
  CHK_JE_STATUS, CHK_JE_STATUS_EXPR, CHK_JE_EVENT_TYPE, CHK_JE_EVENT_TYPE_EXPR,
  CHK_JE_POSTED_HAS_NO, CHK_JE_POSTED_HAS_NO_EXPR,
  CHK_JE_POSTED_BALANCED, CHK_JE_POSTED_BALANCED_EXPR,
  CHK_JE_BACKDATE_REASON, CHK_JE_BACKDATE_REASON_EXPR,
} from '../accounting.constants';

/**
 * رأس القيد.
 *
 * ثلاثة تواريخ لا تختلط أبداً:
 *   source_document_date  متى حدثت العملية فعلاً (من المستند)
 *   accounting_date       أي فترة محاسبية تخص — يحدد الترحيل
 *   created_at            متى أُدخلت إلى النظام — يُكتب مرة ولا يُلمس
 *
 * ⚠️ الثبات بعد الترحيل مفروض بمشغّل قاعدة بيانات لا بالكود — لا التفاف من أي مسار.
 */
@Entity('journal_entries')
@Check(CHK_JE_STATUS, CHK_JE_STATUS_EXPR)
@Check(CHK_JE_EVENT_TYPE, CHK_JE_EVENT_TYPE_EXPR)
@Check(CHK_JE_POSTED_HAS_NO, CHK_JE_POSTED_HAS_NO_EXPR)
@Check(CHK_JE_POSTED_BALANCED, CHK_JE_POSTED_BALANCED_EXPR)
@Check(CHK_JE_BACKDATE_REASON, CHK_JE_BACKDATE_REASON_EXPR)
@Index(UQ_JE_ENTRY_NO, ['legal_entity_id', 'fiscal_year_id', 'entry_no'], { unique: true, where: 'entry_no IS NOT NULL' })
// منع الحدث المحاسبي المكرَّر — نوع الحدث جزء من المفتاح عمداً:
// الفاتورة الواحدة تولّد استحقاقاً ثم تسوية ثم عكساً، وكلها مشروعة.
@Index(UQ_JE_EVENT, ['legal_entity_id', 'accounting_event_type', 'source_type', 'source_id'],
  { unique: true, where: "source_id IS NOT NULL AND status <> 'void'" })
@Index(IDX_JE_PERIOD, ['legal_entity_id', 'fiscal_period_id', 'status'])
@Index(IDX_JE_SOURCE, ['source_type', 'source_id'], { where: 'source_id IS NOT NULL' })
@Index(IDX_JE_BACKDATED, ['legal_entity_id', 'is_backdated'], { where: 'is_backdated' })
export class JournalEntry {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'uuid' }) legal_entity_id: string;
  @Column({ type: 'uuid' }) journal_id: string;
  @Column({ type: 'uuid' }) fiscal_year_id: string;
  @Column({ type: 'uuid' }) fiscal_period_id: string;

  /** الرقم الرسمي يُسنَد عند الترحيل فقط — فالمسوّدات الملغاة لا تُحدث فجوات. */
  @Column({ type: 'varchar', length: 30, nullable: true }) entry_no: string | null;

  @Column({ type: 'varchar', length: 15, default: 'draft' }) status: string;
  @Column({ type: 'varchar', length: 30, default: 'manual' }) accounting_event_type: string;

  @Column({ type: 'date' }) source_document_date: string;
  @Column({ type: 'date' }) accounting_date: string;
  @Column({ type: 'varchar', length: 500 }) description: string;
  @Column({ type: 'varchar', length: 200, nullable: true }) reference: string | null;

  @Column({ type: 'varchar', length: 30, nullable: true }) source_type: string | null;
  @Column({ type: 'uuid', nullable: true }) source_id: string | null;
  @Column({ type: 'varchar', length: 200, nullable: true }) source_reference: string | null;

  @Column({ type: 'boolean', default: false }) is_backdated: boolean;
  @Column({ type: 'varchar', length: 500, nullable: true }) backdated_reason: string | null;

  @Column({ type: 'uuid', nullable: true }) reversal_of_entry_id: string | null;
  @Column({ type: 'uuid', nullable: true }) reversed_by_entry_id: string | null;

  @Column({ type: 'numeric', precision: 18, scale: 2, default: 0 }) total_debit_eur: string;
  @Column({ type: 'numeric', precision: 18, scale: 2, default: 0 }) total_credit_eur: string;

  @Column({ type: 'uuid', nullable: true }) created_by: string | null;
  @CreateDateColumn({ type: 'timestamptz' }) created_at: Date;
  @Column({ type: 'uuid', nullable: true }) reviewed_by: string | null;
  @Column({ type: 'timestamptz', nullable: true }) reviewed_at: Date | null;
  @Column({ type: 'uuid', nullable: true }) posted_by: string | null;
  @Column({ type: 'timestamptz', nullable: true }) posted_at: Date | null;
  @UpdateDateColumn({ type: 'timestamptz' }) updated_at: Date;

  @ManyToOne(() => LegalEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'legal_entity_id', foreignKeyConstraintName: FK_JE_ENTITY })
  legal_entity: LegalEntity;

  @ManyToOne(() => Journal, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'journal_id', foreignKeyConstraintName: FK_JE_JOURNAL })
  journal: Journal;

  @ManyToOne(() => FiscalYear, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'fiscal_year_id', foreignKeyConstraintName: FK_JE_FY })
  fiscal_year: FiscalYear;

  @ManyToOne(() => FiscalPeriod, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'fiscal_period_id', foreignKeyConstraintName: FK_JE_PERIOD })
  fiscal_period: FiscalPeriod;

  @ManyToOne(() => JournalEntry, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'reversal_of_entry_id', foreignKeyConstraintName: FK_JE_REVERSAL_OF })
  reversal_of: JournalEntry | null;

  @ManyToOne(() => JournalEntry, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'reversed_by_entry_id', foreignKeyConstraintName: FK_JE_REVERSED_BY })
  reversed_by: JournalEntry | null;

  @OneToMany(() => JournalLine, (l) => l.entry)
  lines: JournalLine[];
}
