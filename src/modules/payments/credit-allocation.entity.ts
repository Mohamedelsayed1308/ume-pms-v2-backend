import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, JoinColumn, Index, Check } from 'typeorm';
import { Invoice } from '../invoices/invoice.entity';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * تطبيق إشعارٍ دائن على فاتورة — بأمر المالك ٦ أكتوبر ٢٠٢٦
 *
 * الإشعار الدائن فاتورةٌ سالبة من المورّد نفسه. والمالك يخصمه من مبلغ التحويل،
 * فيُسجَّل هنا سطرٌ: «طُبّق من الإشعار كذا على الفاتورة كذا بمبلغ كذا».
 *
 * ── ولماذا لا سدادٌ سالب ──
 * السداد يُرحَّل قيداً على البنك، ومحرّك القيود يرفض السالب. ولو لم يُرحَّل لقيّد
 * البنكُ مجموع الفواتير كاملةً لا ما حُوّل فعلاً. فالتطبيق تسويةٌ داخل حساب
 * المورّد لا تمسّ البنك، والسداد النقديّ يبقى بما حُوّل وحده.
 *
 * ── وأثره في الحالة ──
 * مسدَّد الفاتورة = سداداتها + ما طُبّق عليها. ومسدَّد الإشعار = − ما طُبّق منه
 * (سالبٌ كإجماليّه)، فيُغلق حين يُستنفد. انظر `actualPaid` في
 * `common/payment-derivation.ts`. هجرته: `docs/credit-note-allocations-up.sql`.
 * ═══════════════════════════════════════════════════════════════════════════
 */
// أسماء القيود والفهارس كما في الهجرة حرفيّاً — synchronize (في التطوير) يُسقط ما لا يجده بالاسم
@Entity('credit_note_allocations')
@Check('credit_note_allocations_amount_chk', '"amount" > 0')
@Check('credit_note_allocations_distinct_chk', '"credit_note_id" <> "invoice_id"')
export class CreditAllocation {
  @PrimaryGeneratedColumn('uuid') id: string;

  /** الإشعار الدائن (فاتورةٌ سالبة) الذي يُطبَّق منه */
  @Index('IDX_credit_note_allocations_credit_note_id')
  @Column({ type: 'uuid' }) credit_note_id: string;

  /** الفاتورة (موجبة) التي يُطبَّق عليها */
  @Index('IDX_credit_note_allocations_invoice_id')
  @Column({ type: 'uuid' }) invoice_id: string;

  /** موجبٌ دائماً — مقدار ما نُقل من رصيد الإشعار إلى سداد الفاتورة */
  @Column({ type: 'numeric', precision: 15, scale: 2 }) amount: string;
  @Column({ type: 'varchar', length: 10 }) currency: string;
  @Column({ type: 'date' }) allocation_date: string;

  @Column({ type: 'varchar', length: 200, default: '' }) reference: string;
  @Column({ type: 'text', default: '' }) notes: string;
  /** يجمع تطبيقات دفعةٍ واحدة ودفعاتها — تُسجَّل معاً في معاملةٍ واحدة */
  @Column({ type: 'uuid', nullable: true }) batch_ref: string | null;

  @Column({ type: 'varchar', length: 120, default: '' }) created_by: string;
  @CreateDateColumn({ type: 'timestamptz' }) created_at: Date;

  @ManyToOne(() => Invoice, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'credit_note_id', foreignKeyConstraintName: 'credit_note_allocations_credit_note_fk' })
  credit_note: Invoice;

  @ManyToOne(() => Invoice, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'invoice_id', foreignKeyConstraintName: 'credit_note_allocations_invoice_fk' })
  invoice: Invoice;
}
