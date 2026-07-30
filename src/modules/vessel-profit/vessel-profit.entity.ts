import { Entity, PrimaryGeneratedColumn, Column, UpdateDateColumn } from 'typeorm';

// بيانات تقرير ربح المركب المحفوظة (بيلاجوس وغيره) — الرحلات المستخرجة + القيم اليدوية لكل شهر
@Entity('vessel_profit_data')
export class VesselProfitData {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  vessel: string; // e.g. 'Pelagos'

  @Column({ type: 'jsonb', nullable: true })
  voyages: any; // array of parsed voyages

  @Column({ type: 'jsonb', nullable: true })
  manual: any; // { [month]: { opening, closing, salaries } }

  @UpdateDateColumn()
  updated_at: Date;
}
