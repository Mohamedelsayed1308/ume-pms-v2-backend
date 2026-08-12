import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, JoinColumn, Index } from 'typeorm';
import { LegalEntity } from './legal-entity.entity';
import { FK_JOURNAL_ENTITY, UQ_JOURNAL_CODE } from '../accounting.constants';

/** دفتر يومية — يحمل بادئة الترقيم ويفصل القيود حسب طبيعتها للمدقق. */
@Entity('journals')
@Index(UQ_JOURNAL_CODE, ['legal_entity_id', 'code'], { unique: true })
export class Journal {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'uuid' }) legal_entity_id: string;
  @Column({ type: 'varchar', length: 10 }) code: string;
  @Column({ type: 'varchar', length: 100 }) name: string;
  @Column({ type: 'varchar', length: 10 }) entry_prefix: string;
  @Column({ type: 'boolean', default: true }) is_active: boolean;
  @CreateDateColumn({ type: 'timestamptz' }) created_at: Date;

  @ManyToOne(() => LegalEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'legal_entity_id', foreignKeyConstraintName: FK_JOURNAL_ENTITY })
  legal_entity: LegalEntity;
}
