import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn } from 'typeorm';
import { HireInvoice } from './hire-invoice.entity';

@Entity('hire_invoice_items')
export class HireInvoiceItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  hire_invoice_id: string;

  @Column({ type: 'int', nullable: true })
  days: number;

  @Column({ type: 'text' })
  description: string;

  @Column({ type: 'decimal', precision: 15, scale: 2, nullable: true })
  daily_hire: number;

  @Column({ type: 'decimal', precision: 15, scale: 2 })
  amount: number;

  @Column({ type: 'int', default: 0 })
  sort_order: number;

  /**
   * نوعُ البند — وعليه يقوم أساسُ عمولة البروكر.
   *
   *   `hire`      إيجارٌ · يدخل الأساس
   *   `other`     بندٌ آخر · لا يدخل — تموينٌ وغسيلٌ وتعويضاتٌ
   *   `off_hire`  إيقافٌ عن الإيجار · لا يدخل
   *
   * ── لماذا نوعٌ لا علامةٌ منطقيّة ──
   * البند يقول **ما هو** لا «أيُحتسب أم لا». فيخدم العمولة اليوم وأيّ قاعدةٍ
   * تأتي غداً بلا عمودٍ ثانٍ.
   *
   * ── ولماذا لا يُشتقّ من الوصف ──
   * `Off Hire` مصطلحٌ قياسيّ معناه **خصم**، ومطابقةُ كلمة «hire» تُدخله في
   * الأساس فتزيد العمولة — خطأً صامتاً في الاتّجاه المعاكس.
   *
   * الهجرة: docs/hire-item-kind-up.sql
   */
  @Column({ type: 'varchar', length: 20, default: 'hire' })
  item_kind: string;

  @ManyToOne(() => HireInvoice, (inv) => inv.items, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'hire_invoice_id' })
  hire_invoice: HireInvoice;
}
