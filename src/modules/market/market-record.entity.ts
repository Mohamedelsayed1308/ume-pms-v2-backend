import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

// سجل تحليل السوق: سفينة واحدة × شهر واحد. المفتاح المنطقي (year + month_number + ship_key).
@Entity('market_records')
@Index(['year', 'month_number', 'ship_key'], { unique: true })
export class MarketRecord {
  @PrimaryGeneratedColumn('uuid') id: string;

  @Column({ type: 'int' }) year: number;
  @Column({ type: 'int' }) month_number: number;
  @Column({ length: 20, nullable: true }) month_name: string;
  @Column({ type: 'date', nullable: true }) period_start: string;
  @Column({ type: 'date', nullable: true }) period_end: string;

  @Column({ length: 60 }) ship_key: string;
  @Column({ length: 120, nullable: true }) ship_name_source: string;
  @Column({ length: 120, nullable: true }) ship_name_ar: string;

  // الوكيل كما ورد في ملف الاستيراد (مرجعي). الوكيل الفعلي للتحليل يُحلّ من AgencyHistory حسب الشهر.
  @Column({ length: 40, nullable: true }) agency_key: string;
  @Column({ length: 120, nullable: true }) agency_name_ar: string;

  @Column({ type: 'int', default: 0 }) departure_voyages: number;
  @Column({ type: 'int', default: 0 }) arrival_voyages: number;
  @Column({ type: 'int', default: 0 }) trip_count: number; // = MAX(departure, arrival) — يُتحقَّق خادمياً

  // تصنيفات الشاحنات التسعة — مغادرة
  @Column({ type: 'int', default: 0 }) dep_truck: number;
  @Column({ type: 'int', default: 0 }) dep_dyana: number;
  @Column({ type: 'int', default: 0 }) dep_lory: number;
  @Column({ type: 'int', default: 0 }) dep_loped: number;
  @Column({ type: 'int', default: 0 }) dep_loader: number;
  @Column({ type: 'int', default: 0 }) dep_equipment: number;
  @Column({ type: 'int', default: 0 }) dep_head_track: number;
  @Column({ type: 'int', default: 0 }) dep_mafi: number;
  @Column({ type: 'int', default: 0 }) dep_mafi_empty: number;
  @Column({ type: 'int', default: 0 }) departure_trucks_total: number;

  // تصنيفات الشاحنات التسعة — وصول
  @Column({ type: 'int', default: 0 }) arr_truck: number;
  @Column({ type: 'int', default: 0 }) arr_dyana: number;
  @Column({ type: 'int', default: 0 }) arr_lory: number;
  @Column({ type: 'int', default: 0 }) arr_loped: number;
  @Column({ type: 'int', default: 0 }) arr_loader: number;
  @Column({ type: 'int', default: 0 }) arr_equipment: number;
  @Column({ type: 'int', default: 0 }) arr_head_track: number;
  @Column({ type: 'int', default: 0 }) arr_mafi: number;
  @Column({ type: 'int', default: 0 }) arr_mafi_empty: number;
  @Column({ type: 'int', default: 0 }) arrival_trucks_total: number;

  @Column({ type: 'int', default: 0 }) trucks_total: number; // = مجموع التسعة في الاتجاهين

  @Column({ type: 'int', default: 0 }) departure_cars: number;
  @Column({ type: 'int', default: 0 }) arrival_cars: number;
  @Column({ type: 'int', default: 0 }) cars_total: number;

  @Column({ type: 'int', default: 0 }) departure_passengers: number;
  @Column({ type: 'int', default: 0 }) arrival_passengers: number;
  @Column({ type: 'int', default: 0 }) passengers_total: number;

  @Column({ length: 30, nullable: true }) data_status: string;
  @Column({ length: 60, nullable: true }) source_sheet: string;

  // حقول مستقبلية اختيارية (تبقى null حتى تتوفّر — تُخفى في الواجهة، لا تُختلق)
  @Column({ type: 'decimal', precision: 15, scale: 2, nullable: true }) revenue: number | null;
  @Column({ type: 'decimal', precision: 15, scale: 2, nullable: true }) direct_cost: number | null;
  @Column({ type: 'decimal', precision: 15, scale: 2, nullable: true }) gross_profit: number | null;
  @Column({ type: 'int', nullable: true }) customers_count: number | null;
  @Column({ type: 'int', nullable: true }) truck_capacity: number | null;
  @Column({ type: 'int', nullable: true }) car_capacity: number | null;
  @Column({ type: 'int', nullable: true }) passenger_capacity: number | null;

  @Column({ length: 60, nullable: true }) import_batch: string; // ربط بسجل الاستيراد

  @CreateDateColumn() created_at: Date;
  @UpdateDateColumn() updated_at: Date;
}
