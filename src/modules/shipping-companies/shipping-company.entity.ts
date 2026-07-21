import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('shipping_companies')
export class ShippingCompany {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ length: 200 })
  name: string;

  @Column({ type: 'text', nullable: true })
  address: string;

  @Column({ length: 100, nullable: true })
  bank_name: string;

  @Column({ length: 200, nullable: true })
  acc_name: string;

  @Column({ length: 50, nullable: true })
  iban_eur: string;

  @Column({ length: 50, nullable: true })
  iban_usd: string;

  @Column({ length: 20, nullable: true })
  swift_code: string;

  @Column({ default: true })
  is_active: boolean;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
