import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, JoinColumn, Index, Check } from 'typeorm';
import { LegalEntity } from './legal-entity.entity';
import {
  FK_FX_ENTITY, UQ_FX_RATE, IDX_FX_LOOKUP,
  CHK_FX_RATE_POSITIVE, CHK_FX_RATE_POSITIVE_EXPR,
  CHK_FX_SOURCE, CHK_FX_SOURCE_EXPR,
  CHK_FX_MANUAL_APPROVED, CHK_FX_MANUAL_APPROVED_EXPR,
} from '../accounting.constants';

/**
 * أسعار الصرف المحاسبية — مستقلة تماماً عن exchange_rates و currencies القائمَين.
 * ذانك مربوطان بالدولار ويُستبدلان بلا تاريخ ولا مصدر ولا معتمِد، فلا يصلحان
 * لإثبات السعر المستخدم لحظة الترحيل أمام مدقق.
 *
 * لا سعر بلا تاريخ ومصدر. والسعر اليدوي لا يُقبل بلا معتمِد — مفروض بقيد.
 */
@Entity('accounting_fx_rates')
@Check(CHK_FX_RATE_POSITIVE, CHK_FX_RATE_POSITIVE_EXPR)
@Check(CHK_FX_SOURCE, CHK_FX_SOURCE_EXPR)
@Check(CHK_FX_MANUAL_APPROVED, CHK_FX_MANUAL_APPROVED_EXPR)
@Index(UQ_FX_RATE, ['legal_entity_id', 'currency_from', 'currency_to', 'rate_date', 'source'], { unique: true })
@Index(IDX_FX_LOOKUP, ['legal_entity_id', 'currency_from', 'rate_date'])
export class AccountingFxRate {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'uuid' }) legal_entity_id: string;
  @Column({ type: 'varchar', length: 3 }) currency_from: string;
  @Column({ type: 'varchar', length: 3 }) currency_to: string;
  @Column({ type: 'numeric', precision: 18, scale: 8 }) rate: string;
  @Column({ type: 'date' }) rate_date: string;
  @Column({ type: 'varchar', length: 20 }) source: string;
  @Column({ type: 'varchar', length: 200, nullable: true }) source_reference: string | null;
  @Column({ type: 'uuid', nullable: true }) created_by: string | null;
  @CreateDateColumn({ type: 'timestamptz' }) created_at: Date;
  @Column({ type: 'uuid', nullable: true }) approved_by: string | null;
  @Column({ type: 'timestamptz', nullable: true }) approved_at: Date | null;

  @ManyToOne(() => LegalEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'legal_entity_id', foreignKeyConstraintName: FK_FX_ENTITY })
  legal_entity: LegalEntity;
}
