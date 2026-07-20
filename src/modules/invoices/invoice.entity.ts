import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne, OneToMany, JoinColumn } from 'typeorm';
import { Supplier } from '../suppliers/supplier.entity';
import { Vessel } from '../vessels/vessel.entity';
import { PurchaseOrder } from '../purchase-orders/purchase-order.entity';
import { Payment } from '../payments/payment.entity';

export enum InvoiceType {
  PRELIMINARY = 'preliminary',
  FINAL = 'final',
}

export enum InvoiceStatus {
  UNPAID = 'unpaid',
  PARTIAL = 'partial',
  PAID = 'paid',
  CANCELLED = 'cancelled',
}

export enum ApprovalStatus {
  BOOKING_WAITING_PAYMENT = 'booking_waiting_payment',
  WAITING_APPROVAL = 'waiting_approval',
  WAITING_PO = 'waiting_po',
  SEND_TO_PAY = 'send_to_pay',
  HOLD = 'hold',
  DELIVERY_MISSING = 'delivery_missing',
  PAID = 'paid',
}

@Entity('invoices')
export class Invoice {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ length: 100, unique: true })
  invoice_number: string;

  @Column({ type: 'uuid' })
  supplier_id: string;

  @Column({ type: 'uuid', nullable: true })
  vessel_id: string;

  @Column({ type: 'uuid', nullable: true })
  po_id: string;

  @Column({ type: 'enum', enum: InvoiceType, default: InvoiceType.PRELIMINARY })
  type: InvoiceType;

  @Column({ type: 'enum', enum: InvoiceStatus, default: InvoiceStatus.UNPAID })
  status: InvoiceStatus;

  @Column({ length: 10, default: 'USD' })
  currency: string;

  @Column({ type: 'decimal', precision: 15, scale: 2 })
  total_amount: number;

  @Column({ type: 'decimal', precision: 15, scale: 2, default: 0 })
  paid_amount: number;

  @Column({ type: 'date', nullable: true })
  invoice_date: Date;

  @Column({ type: 'date', nullable: true })
  due_date: Date;

  @Column({ length: 500, nullable: true })
  description: string;

  @Column({ length: 200, nullable: true })
  notes: string;

  @Column({ type: 'varchar', length: 50, nullable: true })
  approval_status: string;

  @Column({ type: 'text', nullable: true })
  comment: string;

  @Column({ type: 'uuid', nullable: true })
  created_by_id: string;

  @Column({ length: 100, nullable: true })
  created_by_name: string;

  @Column({ type: 'date', nullable: true })
  approval_status_date: Date;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;

  @ManyToOne(() => Supplier)
  @JoinColumn({ name: 'supplier_id' })
  supplier: Supplier;

  @ManyToOne(() => Vessel)
  @JoinColumn({ name: 'vessel_id' })
  vessel: Vessel;

  @ManyToOne(() => PurchaseOrder, (po) => po.invoices)
  @JoinColumn({ name: 'po_id' })
  purchase_order: PurchaseOrder;

  @OneToMany(() => Payment, (p) => p.invoice)
  payments: Payment[];

  get remaining_amount(): number {
    return +this.total_amount - +this.paid_amount;
  }
}
