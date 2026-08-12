import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

/** افتراضي المورّد المحاسبي — اقتراحٌ يملأ الحقل، لا قرارٌ يُلزم القيد. */
@Entity('supplier_accounting_defaults')
export class SupplierAccountingDefault {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'uuid' }) legal_entity_id: string;
  @Column({ type: 'uuid' }) supplier_id: string;
  @Column({ type: 'uuid' }) debit_account_id: string;
  @Column({ type: 'varchar', length: 20 }) accrual_category: string;
  @Column({ type: 'varchar', length: 300, nullable: true }) notes: string | null;
  @CreateDateColumn({ type: 'timestamptz' }) created_at: Date;
  @UpdateDateColumn({ type: 'timestamptz' }) updated_at: Date;
  @Column({ type: 'uuid', nullable: true }) updated_by: string | null;
}
