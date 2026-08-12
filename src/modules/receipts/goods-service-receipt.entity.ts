import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

/**
 * واقعة استلام سلعة أو تأكيد خدمة.
 *
 * جدول مستقل لا أعمدة على `invoices`: الاستلام قد يتكرّر ويتجزّأ ويحمل نوعاً
 * ومرجعاً، وحقلٌ منطقي واحد كان سيغلق ذلك ويستدعي هجرة ثانية عند أول تسليم جزئي.
 *
 * ⚠️ الأنواع الصريحة على الأعمدة القابلة للعدم مقصودة: `emitDecoratorMetadata`
 * يُخرج `Object` لاتحاد `string | null` فيتعثّر الإقلاع.
 */
@Entity('goods_service_receipts')
export class GoodsServiceReceipt {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'uuid' }) invoice_id: string;
  @Column({ type: 'varchar', length: 40 }) receipt_type: string;
  @Column({ type: 'date' }) received_date: string;
  @Column({ type: 'uuid', nullable: true }) received_by: string | null;
  @Column({ type: 'varchar', length: 200, nullable: true }) received_by_name: string | null;
  @Column({ type: 'varchar', length: 200, nullable: true }) reference: string | null;
  @Column({ type: 'varchar', length: 500, nullable: true }) notes: string | null;
  @Column({ type: 'uuid', nullable: true }) attachment_id: string | null;
  @Column({ type: 'boolean', default: false }) is_partial: boolean;
  @CreateDateColumn({ type: 'timestamptz' }) created_at: Date;
  @Column({ type: 'uuid', nullable: true }) created_by: string | null;
}
