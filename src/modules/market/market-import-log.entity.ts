import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

// سجل تدقيق لكل عملية رفع ملف (اسم الملف، الوقت، المستخدم، المقبول/المرفوض، الأسباب).
@Entity('market_import_logs')
export class MarketImportLog {
  @PrimaryGeneratedColumn('uuid') id: string;

  @Column({ length: 260, nullable: true }) filename: string;
  @Column({ length: 120, nullable: true }) uploaded_by: string;
  @Column({ length: 60, nullable: true }) uploaded_by_id: string;

  @Column({ type: 'int', default: 0 }) rows_total: number;
  @Column({ type: 'int', default: 0 }) rows_accepted: number;
  @Column({ type: 'int', default: 0 }) rows_rejected: number;
  @Column({ type: 'jsonb', nullable: true }) rejects: any;    // [{row, reasons[]}]
  @Column({ type: 'jsonb', nullable: true }) mismatches: any; // اختلافات القيم المحسوبة عن قيم الملف

  @Column({ length: 30, default: 'committed' }) status: string; // committed | preview | failed

  @CreateDateColumn() created_at: Date;
}
