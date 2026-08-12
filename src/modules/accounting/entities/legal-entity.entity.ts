import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';
import { UQ_ENTITY_CODE } from '../accounting.constants';

/** الكيان القانوني المحاسبي. Sivamar أول صف — لا كود باسمها في أي مكان. */
@Entity('legal_entities')
@Index(UQ_ENTITY_CODE, ['code'], { unique: true })
export class LegalEntity {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'varchar', length: 20 }) code: string;
  @Column({ type: 'varchar', length: 200 }) name: string;
  @Column({ type: 'varchar', length: 200, nullable: true }) name_ar: string | null;
  @Column({ type: 'varchar', length: 3 }) functional_currency: string;
  @Column({ type: 'smallint', default: 1 }) fiscal_year_start_month: number;
  @Column({ type: 'date' }) accounting_start_date: string;
  @Column({ type: 'boolean', default: true }) is_active: boolean;
  @CreateDateColumn({ type: 'timestamptz' }) created_at: Date;
  @UpdateDateColumn({ type: 'timestamptz' }) updated_at: Date;
}
