import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { ManagementInvoice } from './management-invoice.entity';

@Entity('management_payments')
export class ManagementPayment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  management_invoice_id: string;

  @Column({ type: 'date' })
  payment_date: string;

  @Column({ type: 'decimal', precision: 15, scale: 2 })
  amount: number;

  @Column({ length: 10, default: 'USD' })
  currency: string;

  @Column({ length: 200, nullable: true })
  reference: string;

  @Column({ type: 'text', nullable: true })
  notes: string;

  @CreateDateColumn()
  created_at: Date;

  @ManyToOne(() => ManagementInvoice, (inv) => inv.payments, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'management_invoice_id' })
  management_invoice: ManagementInvoice;
}
