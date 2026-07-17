import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('currencies')
export class Currency {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true, length: 10 })
  code: string; // USD, EUR, EGP...

  @Column({ length: 100 })
  name: string;

  @Column({ type: 'decimal', precision: 10, scale: 4, default: 1 })
  rate_to_usd: number;

  @Column({ default: true })
  is_active: boolean;

  @CreateDateColumn()
  created_at: Date;
}
