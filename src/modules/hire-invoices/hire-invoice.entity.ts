import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne, OneToMany, JoinColumn } from 'typeorm';
import { Customer } from '../customers/customer.entity';
import { ShippingCompany } from '../shipping-companies/shipping-company.entity';
import { Vessel } from '../vessels/vessel.entity';
import { HireInvoiceItem } from './hire-invoice-item.entity';
import { HirePayment } from './hire-payment.entity';

@Entity('hire_invoices')
export class HireInvoice {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ length: 50, unique: true })
  invoice_number: string;

  @Column({ type: 'date' })
  invoice_date: Date;

  @Column({ type: 'uuid' })
  customer_id: string;

  @Column({ type: 'uuid' })
  vessel_id: string;

  @Column({ type: 'uuid' })
  shipping_company_id: string;

  @Column({ length: 100, nullable: true })
  place_of_business: string;

  @Column({ type: 'date', nullable: true })
  cp_date: Date;

  @Column({ type: 'timestamp', nullable: true })
  hire_from: Date;

  @Column({ type: 'timestamp', nullable: true })
  hire_to: Date;

  @Column({ length: 10, default: 'EUR' })
  currency: string;

  @Column({ type: 'decimal', precision: 15, scale: 2, default: 0 })
  total_amount: number;

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

  @ManyToOne(() => Customer)
  @JoinColumn({ name: 'customer_id' })
  customer: Customer;

  @ManyToOne(() => Vessel)
  @JoinColumn({ name: 'vessel_id' })
  vessel: Vessel;

  @ManyToOne(() => ShippingCompany)
  @JoinColumn({ name: 'shipping_company_id' })
  shipping_company: ShippingCompany;

  @OneToMany(() => HireInvoiceItem, (item) => item.hire_invoice, { cascade: true })
  items: HireInvoiceItem[];

  @OneToMany(() => HirePayment, (p) => p.hire_invoice)
  payments: HirePayment[];
}
