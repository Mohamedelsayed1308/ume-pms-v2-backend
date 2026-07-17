import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, OneToMany } from 'typeorm';
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

  @Column({ default: true })
  is_active: boolean;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;

  @OneToMany(() => PurchaseOrder, (po) => po.vessel)
  purchase_orders: PurchaseOrder[];
}
