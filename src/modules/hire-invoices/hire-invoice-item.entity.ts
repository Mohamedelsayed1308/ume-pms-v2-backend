import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn } from 'typeorm';
import { HireInvoice } from './hire-invoice.entity';

@Entity('hire_invoice_items')
export class HireInvoiceItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  hire_invoice_id: string;

  @Column({ type: 'int', nullable: true })
  days: number;

  @Column({ type: 'text' })
  description: string;

  @Column({ type: 'decimal', precision: 15, scale: 2, nullable: true })
  daily_hire: number;

  @Column({ type: 'decimal', precision: 15, scale: 2 })
  amount: number;

  @Column({ type: 'int', default: 0 })
  sort_order: number;

  @ManyToOne(() => HireInvoice, (inv) => inv.items, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'hire_invoice_id' })
  hire_invoice: HireInvoice;
}
