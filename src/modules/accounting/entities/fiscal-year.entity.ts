import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, JoinColumn, Index } from 'typeorm';
import { LegalEntity } from './legal-entity.entity';
import { FK_FY_ENTITY, UQ_FY } from '../accounting.constants';

@Entity('fiscal_years')
@Index(UQ_FY, ['legal_entity_id', 'year'], { unique: true })
export class FiscalYear {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'uuid' }) legal_entity_id: string;
  @Column({ type: 'smallint' }) year: number;
  @Column({ type: 'date' }) start_date: string;
  @Column({ type: 'date' }) end_date: string;
  @Column({ type: 'varchar', length: 15, default: 'open' }) status: string;

  /**
   * عدّاد الترقيم الرسمي. يُقفل صفّه داخل معاملة الترحيل:
   * فلا رقمان متطابقان عند التزامن، ولا فجوة عند التراجع.
   */
  @Column({ type: 'int', default: 1 }) next_entry_no: number;

  @CreateDateColumn({ type: 'timestamptz' }) created_at: Date;

  @ManyToOne(() => LegalEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'legal_entity_id', foreignKeyConstraintName: FK_FY_ENTITY })
  legal_entity: LegalEntity;
}
