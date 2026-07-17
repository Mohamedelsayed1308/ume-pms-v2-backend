import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { Invoice } from '../invoices/invoice.entity';

export enum PaymentType {
  ADVANCE = 'advance',       // دفعة مقدمة
  INSTALLMENT = 'installment', // قسط
  FULL = 'full',             // سداد كامل
}

export enum PaymentMethod {
  BANK_TRANSFER = 'bank_transfer',
  CHEQUE = 'cheque',
  CASH = 'cash',
}

@Entity('payments')
export class Payment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  invoice_id: string;

  @Column({ type: 'enum', enum: PaymentType, default: PaymentType.INSTALLMENT })
  payment_type: PaymentType;

  @Column({ type: 'enum', enum: PaymentMethod, default: PaymentMethod.BANK_TRANSFER })
  payment_method: PaymentMethod;

  @Column({ length: 10, default: 'USD' })
  currency: string;

  @Column({ type: 'decimal', precision: 15, scale: 2 })
  amount: number;

  @Column({ type: 'date' })
  payment_date: Date;

  @Column({ length: 200, nullable: true })
  reference: string; // رقم التحويل البنكي

  @Column({ length: 500, nullable: true })
  notes: string;

  @CreateDateColumn()
  created_at: Date;

  @ManyToOne(() => Invoice, (inv) => inv.payments)
  @JoinColumn({ name: 'invoice_id' })
  invoice: Invoice;
}
