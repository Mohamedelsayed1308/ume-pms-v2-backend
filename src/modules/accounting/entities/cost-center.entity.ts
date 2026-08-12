import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, JoinColumn, Index } from 'typeorm';
import { LegalEntity } from './legal-entity.entity';
import { FK_CC_ENTITY, UQ_CC_CODE } from '../accounting.constants';

/** بُعد اختياري — يبقى فارغاً حتى تنشأ الحاجة. وجوده الآن يجنّب فقد البُعد على القيود القديمة لاحقاً. */
@Entity('cost_centers')
@Index(UQ_CC_CODE, ['legal_entity_id', 'code'], { unique: true })
export class CostCenter {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'uuid' }) legal_entity_id: string;
  @Column({ type: 'varchar', length: 20 }) code: string;
  @Column({ type: 'varchar', length: 200 }) name: string;
  @Column({ type: 'boolean', default: true }) is_active: boolean;
  @CreateDateColumn({ type: 'timestamptz' }) created_at: Date;

  @ManyToOne(() => LegalEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'legal_entity_id', foreignKeyConstraintName: FK_CC_ENTITY })
  legal_entity: LegalEntity;
}
