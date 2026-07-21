import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, OneToMany, ManyToOne, JoinColumn } from 'typeorm';
import { ShippingCompany } from '../shipping-companies/shipping-company.entity';
import { PurchaseOrder } from '../purchase-orders/purchase-order.entity';

@Entity('vessels')
export class Vessel {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ length: 200 })
  name: string;

  @Column({ length: 20, nullable: true, unique: true })
  imo_number: string;

  @Column({ length: 100, nullable: true })
  flag: string;

  @Column({ length: 100, nullable: true })
  vessel_type: string;

  @Column({ type: 'uuid', nullable: true })
  shipping_company_id: string;

  @Column({ default: true })
  is_active: boolean;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;

  @ManyToOne(() => ShippingCompany, { nullable: true })
  @JoinColumn({ name: 'shipping_company_id' })
  shipping_company: ShippingCompany;

  @OneToMany(() => PurchaseOrder, (po) => po.vessel)
  purchase_orders: PurchaseOrder[];
}
