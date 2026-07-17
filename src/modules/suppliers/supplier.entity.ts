import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, OneToMany } from 'typeorm';
import { PurchaseOrder } from '../purchase-orders/purchase-order.entity';

@Entity('suppliers')
export class Supplier {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ length: 200 })
  name: string;

  @Column({ length: 100, nullable: true })
  contact_person: string;

  @Column({ length: 100, nullable: true })
  email: string;

  @Column({ length: 50, nullable: true })
  phone: string;

  @Column({ length: 200, nullable: true })
  address: string;

  @Column({ length: 100, nullable: true })
  country: string;

  @Column({ default: true })
  is_active: boolean;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;

  @OneToMany(() => PurchaseOrder, (po) => po.supplier)
  purchase_orders: PurchaseOrder[];
}
