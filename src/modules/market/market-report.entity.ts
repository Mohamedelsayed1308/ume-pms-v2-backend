import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

// تقرير إدارة محفوظ (Snapshot): يُجمّد الأرقام المستخدمة وقت الإنشاء ولا يتغيّر بتغيّر البيانات لاحقاً.
@Entity('market_reports')
export class MarketReport {
  @PrimaryGeneratedColumn('uuid') id: string;

  @Column({ type: 'int' }) from_year: number;
  @Column({ type: 'int' }) from_month: number;
  @Column({ type: 'int' }) to_year: number;
  @Column({ type: 'int' }) to_month: number;

  @Column({ type: 'jsonb', nullable: true }) filters: any;   // { agencies, ship }
  @Column({ length: 20, default: 'executive' }) level: string; // executive | detailed

  @Column({ type: 'jsonb', nullable: true }) numbers_snapshot: any; // الأرقام المحسوبة خادمياً وقت الإنشاء
  @Column({ type: 'jsonb', nullable: true }) report_json: any;      // مخرجات الذكاء الاصطناعي المنظمة (بعد التحقق)

  @Column({ length: 40, nullable: true }) template_version: string;
  @Column({ length: 60, nullable: true }) model: string;

  @Column({ length: 120, nullable: true }) created_by: string;
  @Column({ length: 60, nullable: true }) created_by_id: string;
  @CreateDateColumn() created_at: Date;
}
