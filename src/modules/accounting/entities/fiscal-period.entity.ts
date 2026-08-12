import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, JoinColumn, Index, Check } from 'typeorm';
import { LegalEntity } from './legal-entity.entity';
import { FiscalYear } from './fiscal-year.entity';
import {
  FK_PERIOD_ENTITY, FK_PERIOD_FY, UQ_PERIOD,
  CHK_PERIOD_STATUS, CHK_PERIOD_STATUS_EXPR, CHK_PERIOD_NO, CHK_PERIOD_NO_EXPR,
  CHK_PERIOD_DATES, CHK_PERIOD_DATES_EXPR,
} from '../accounting.constants';

/** period_no = 0 هي الفترة الافتتاحية (31/12/2025) — تفصل الرصيد الافتتاحي عن حركة يناير. */
@Entity('fiscal_periods')
@Check(CHK_PERIOD_STATUS, CHK_PERIOD_STATUS_EXPR)
@Check(CHK_PERIOD_NO, CHK_PERIOD_NO_EXPR)
@Check(CHK_PERIOD_DATES, CHK_PERIOD_DATES_EXPR)
@Index(UQ_PERIOD, ['fiscal_year_id', 'period_no'], { unique: true })
export class FiscalPeriod {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'uuid' }) legal_entity_id: string;
  @Column({ type: 'uuid' }) fiscal_year_id: string;
  @Column({ type: 'smallint' }) period_no: number;
  @Column({ type: 'varchar', length: 30 }) name: string;
  @Column({ type: 'date' }) start_date: string;
  @Column({ type: 'date' }) end_date: string;
  @Column({ type: 'varchar', length: 15, default: 'open' }) status: string;
  @Column({ type: 'uuid', nullable: true }) closed_by: string | null;
  @Column({ type: 'timestamptz', nullable: true }) closed_at: Date | null;
  @Column({ type: 'varchar', length: 500, nullable: true }) close_reason: string | null;
  @Column({ type: 'uuid', nullable: true }) reopened_by: string | null;
  @Column({ type: 'timestamptz', nullable: true }) reopened_at: Date | null;
  @Column({ type: 'varchar', length: 500, nullable: true }) reopen_reason: string | null;
  @CreateDateColumn({ type: 'timestamptz' }) created_at: Date;

  @ManyToOne(() => LegalEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'legal_entity_id', foreignKeyConstraintName: FK_PERIOD_ENTITY })
  legal_entity: LegalEntity;

  @ManyToOne(() => FiscalYear, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'fiscal_year_id', foreignKeyConstraintName: FK_PERIOD_FY })
  fiscal_year: FiscalYear;
}
