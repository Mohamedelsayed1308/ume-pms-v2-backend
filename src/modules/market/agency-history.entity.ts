import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

// تاريخ وكالة السفينة عبر الزمن. لا نربط السفينة بوكيل ثابت — الوكيل يُحلّ حسب شهر الحركة.
@Entity('agency_history')
@Index(['ship_key', 'valid_from'])
export class AgencyHistory {
  @PrimaryGeneratedColumn('uuid') id: string;

  @Column({ length: 60 }) ship_key: string;
  @Column({ length: 120, nullable: true }) ship_name_ar: string;
  @Column({ length: 40 }) agency_key: string;
  @Column({ length: 120, nullable: true }) agency_name_ar: string;

  @Column({ type: 'date' }) valid_from: string;          // شامل
  @Column({ type: 'date', nullable: true }) valid_to: string | null; // null = مفتوح/حالي

  @Column({ type: 'text', nullable: true }) notes: string;

  @CreateDateColumn() created_at: Date;
}
