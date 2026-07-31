import { Entity, PrimaryGeneratedColumn, Column, UpdateDateColumn } from 'typeorm';

// أسعار صرف العملات لكل شهر — القيمة = كم من العملة مقابل 1 دولار (1 USD = X)
@Entity('exchange_rates')
export class ExchangeRate {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  month: string; // 'YYYY-MM'

  @Column({ type: 'jsonb', nullable: true })
  rates: any; // { EGP: 50, SAR: 3.75, EUR: 0.92, ... }

  @UpdateDateColumn()
  updated_at: Date;
}
