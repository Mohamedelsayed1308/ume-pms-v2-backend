import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('profit_periods')
export class ProfitPeriod {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ length: 200 })
  period_name: string;

  @Column({ type: 'date' })
  date_from: string;

  @Column({ type: 'date' })
  date_to: string;

  // ── إيرادات العبارات (من Excel أو يدوي) ──────────────────────────────
  @Column({ type: 'decimal', precision: 15, scale: 4, default: 0 }) poseidon_revenue: number;
  @Column({ type: 'decimal', precision: 15, scale: 4, default: 0 }) amal_revenue: number;
  @Column({ type: 'decimal', precision: 15, scale: 4, default: 0 }) daleela_revenue: number;

  @Column({ type: 'int', default: 0 }) poseidon_voyages: number;
  @Column({ type: 'int', default: 0 }) amal_voyages: number;
  @Column({ type: 'int', default: 0 }) daleela_voyages: number;

  @Column({ type: 'decimal', precision: 15, scale: 4, default: 0 }) poseidon_over_pax: number;
  @Column({ type: 'decimal', precision: 15, scale: 4, default: 0 }) amal_over_pax: number;
  @Column({ type: 'decimal', precision: 15, scale: 4, default: 0 }) daleela_over_pax: number;

  // ── مدخلات يدوية ──────────────────────────────────────────────────────
  @Column({ type: 'decimal', precision: 15, scale: 4, default: 0 }) poseidon_rent: number;
  @Column({ type: 'decimal', precision: 15, scale: 4, default: 0 }) amal_rent: number;
  @Column({ type: 'decimal', precision: 15, scale: 4, default: 0 }) daleela_rent: number;

  @Column({ type: 'decimal', precision: 15, scale: 4, default: 0 }) cash_safaga_badawi: number;
  @Column({ type: 'decimal', precision: 15, scale: 4, default: 0 }) cash_safaga_ittihad: number;

  @Column({ type: 'decimal', precision: 15, scale: 4, default: 0 }) transfers_badawi: number;
  @Column({ type: 'decimal', precision: 15, scale: 4, default: 0 }) transfers_ittihad: number;

  // ── نسب التوزيع ───────────────────────────────────────────────────────
  @Column({ type: 'decimal', precision: 5, scale: 2, default: 50 }) ratio_badawi: number;
  @Column({ type: 'decimal', precision: 5, scale: 2, default: 50 }) ratio_ittihad: number;

  // ── معاملات الحساب ────────────────────────────────────────────────────
  @Column({ type: 'decimal', precision: 5, scale: 2, default: 6.5 }) commission_rate: number;
  @Column({ type: 'decimal', precision: 10, scale: 2, default: 500 }) per_voyage_fee: number;

  // ── الرصيد المنقول من الفترة السابقة (تراكمي تلقائي) ────────────────
  @Column({ type: 'decimal', precision: 15, scale: 4, default: 0 }) balance_prev_badawi: number;
  @Column({ type: 'decimal', precision: 15, scale: 4, default: 0 }) balance_prev_ittihad: number;

  @Column({ length: 20, default: 'draft' }) status: string;
  @Column({ type: 'text', nullable: true }) notes: string;

  @CreateDateColumn() created_at: Date;
  @UpdateDateColumn() updated_at: Date;
}
