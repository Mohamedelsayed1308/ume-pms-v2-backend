import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne, OneToMany, JoinColumn } from 'typeorm';
import { Supplier } from '../suppliers/supplier.entity';
import { Vessel } from '../vessels/vessel.entity';
import { Invoice } from '../invoices/invoice.entity';

@Entity('purchase_orders')
export class PurchaseOrder {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ length: 100, unique: true })
  po_number: string; // e.g. 06-004/2026-O001

  @Column({ type: 'uuid' })
  supplier_id: string;

  @Column({ type: 'uuid', nullable: true })
  vessel_id: string;

  @Column({ length: 500, nullable: true })
  description: string;

  @Column({ type: 'date', nullable: true })
  order_date: Date;

  @Column({ default: true })
  is_active: boolean;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;

  @ManyToOne(() => Supplier, (s) => s.purchase_orders)
  @JoinColumn({ name: 'supplier_id' })
  supplier: Supplier;

  @ManyToOne(() => Vessel, (v) => v.purchase_orders)
  @JoinColumn({ name: 'vessel_id' })
  vessel: Vessel;

  @OneToMany(() => Invoice, (inv) => inv.purchase_order)
  invoices: Invoice[];
}
