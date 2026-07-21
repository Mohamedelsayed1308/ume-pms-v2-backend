import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, CreateDateColumn } from 'typeorm';
import { HireInvoice } from './hire-invoice.entity';

@Entity('hire_payments')
export class HirePayment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  hire_invoice_id: string;

  @Column({ type: 'date' })
  payment_date: Date;

  @Column({ type: 'decimal', precision: 15, scale: 2 })
  amount: number;

  @Column({ length: 10, default: 'EUR' })
  currency: string;

  @Column({ length: 100, nullable: true })
  reference: string;

  @Column({ type: 'text', nullable: true })
  notes: string;

  @CreateDateColumn()
  created_at: Date;

  @ManyToOne(() => HireInvoice, (inv) => inv.payments, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'hire_invoice_id' })
  hire_invoice: HireInvoice;
}
