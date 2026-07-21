import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne, OneToMany, JoinColumn } from 'typeorm';
import { Vessel } from '../vessels/vessel.entity';
import { ManagementPayment } from './management-payment.entity';

@Entity('management_invoices')
export class ManagementInvoice {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ length: 50 })
  invoice_number: string;

  @Column({ type: 'date' })
  invoice_date: string;

  @Column({ type: 'uuid' })
  vessel_id: string;

  @Column({ type: 'text' })
  description: string;

  @Column({ type: 'decimal', precision: 15, scale: 2, default: 0 })
  amount: number;

  @Column({ length: 10, default: 'USD' })
  currency: string;

  @Column({ type: 'decimal', precision: 15, scale: 2, default: 0 })
  paid_amount: number;

  @Column({ length: 20, default: 'unpaid' })
  status: string;

  @Column({ type: 'text', nullable: true })
  notes: string;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;

  @ManyToOne(() => Vessel, { nullable: false })
  @JoinColumn({ name: 'vessel_id' })
  vessel: Vessel;

  @OneToMany(() => ManagementPayment, (p) => p.management_invoice, { cascade: true })
  payments: ManagementPayment[];
}
