import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

/**
 * دفعة استيراد تاريخي. تجيب عن «من أين جاءت الفاتورة؟» — وهو سؤال منفصل تماماً
 * عن «لماذا تُعتبر مغلقة مالياً؟» الذي يجيب عنه settlement_basis.
 *
 * حقول الاعتماد الأربعة nullable عمداً: لا نملك سنداً إدارياً موثَّقاً، ولا يجوز
 * اختلاق اسم أو مرجع أو تاريخ. تُستكمل عند توفّرها. الإفادة نفسها محفوظة في
 * classification_reason حيث موضعها الصحيح.
 */
@Entity('import_batches')
export class ImportBatch {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ length: 50, unique: true })
  batch_code: string;

  @Column({ length: 500 })
  description: string;

  @Column({ type: 'text' })
  classification_reason: string;

  // النوع صريح إلزاماً: العمود المُعلَن `string | null` يُصدِر design:type = Object،
  // فيعجز TypeORM عن استنتاج نوع القاعدة ويفشل الإقلاع كلياً — لا يلتقطه المُصرِّف.
  @Column({ type: 'varchar', length: 200, nullable: true })
  source: string | null;

  @Column({ type: 'varchar', length: 150, nullable: true })
  approved_by_name: string | null;

  @Column({ type: 'varchar', length: 200, nullable: true })
  approval_reference: string | null;

  @Column({ type: 'date', nullable: true })
  approved_at: Date | null;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updated_at: Date;
}
