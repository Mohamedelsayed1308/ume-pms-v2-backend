import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, JoinColumn, Index, Check } from 'typeorm';
import { JournalEntry } from './journal-entry.entity';
import { AccountingAccount } from './accounting-account.entity';
import { AccountingFxRate } from './accounting-fx-rate.entity';
import { CostCenter } from './cost-center.entity';
import {
  FK_JL_ENTRY, FK_JL_ACCOUNT, FK_JL_FX_RATE, FK_JL_COST_CENTER,
  UQ_JL_LINE, IDX_JL_ACCOUNT, IDX_JL_VESSEL, IDX_JL_SUPPLIER,
  CHK_JL_NONNEG, CHK_JL_NONNEG_EXPR, CHK_JL_ONE_SIDE, CHK_JL_ONE_SIDE_EXPR,
  CHK_JL_EUR_SIDE, CHK_JL_EUR_SIDE_EXPR, CHK_JL_FX_POSITIVE, CHK_JL_FX_POSITIVE_EXPR,
  CHK_JL_EUR_RATE_ONE, CHK_JL_EUR_RATE_ONE_EXPR, CHK_JL_FX_SOURCE, CHK_JL_FX_SOURCE_EXPR,
  CHK_JL_FOREIGN_NEEDS_FX, CHK_JL_FOREIGN_NEEDS_FX_EXPR,
} from '../accounting.constants';

/**
 * سطر القيد.
 *
 * كل سطر يحمل **قيمته الأصلية ودليل تحويلها معاً**: العملة والسعر وتاريخه ومصدره
 * ومرجع السعر المعتمد. لا تحويل ضمني ولا سعر مجهول المصدر — وهذا بالضبط ما كان
 * ينقص `exchange_rates` القائم فجعله غير صالح للترحيل المحاسبي.
 *
 * الأطراف المقابلة (مركب/مورّد/عميل) UUID **بلا مفتاح خارجي عمداً**: جداول الأعمال
 * تخصّ PMS ولا يجوز للمحاسبة أن تقيّد حذفها، والمحاسبة لا تُرحِّل أي طرف في P1.1A.
 */
@Entity('journal_lines')
@Check(CHK_JL_NONNEG, CHK_JL_NONNEG_EXPR)
@Check(CHK_JL_ONE_SIDE, CHK_JL_ONE_SIDE_EXPR)
@Check(CHK_JL_EUR_SIDE, CHK_JL_EUR_SIDE_EXPR)
@Check(CHK_JL_FX_POSITIVE, CHK_JL_FX_POSITIVE_EXPR)
@Check(CHK_JL_EUR_RATE_ONE, CHK_JL_EUR_RATE_ONE_EXPR)
@Check(CHK_JL_FX_SOURCE, CHK_JL_FX_SOURCE_EXPR)
@Check(CHK_JL_FOREIGN_NEEDS_FX, CHK_JL_FOREIGN_NEEDS_FX_EXPR)
@Index(UQ_JL_LINE, ['entry_id', 'line_no'], { unique: true })
@Index(IDX_JL_ACCOUNT, ['account_id', 'entry_id'])
@Index(IDX_JL_VESSEL, ['vessel_id'], { where: 'vessel_id IS NOT NULL' })
@Index(IDX_JL_SUPPLIER, ['supplier_id'], { where: 'supplier_id IS NOT NULL' })
export class JournalLine {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'uuid' }) entry_id: string;
  @Column({ type: 'smallint' }) line_no: number;
  @Column({ type: 'uuid' }) account_id: string;

  @Column({ type: 'numeric', precision: 18, scale: 2, default: 0 }) debit: string;
  @Column({ type: 'numeric', precision: 18, scale: 2, default: 0 }) credit: string;

  @Column({ type: 'varchar', length: 3 }) transaction_currency: string;
  @Column({ type: 'numeric', precision: 18, scale: 8, default: 1 }) fx_rate: string;
  @Column({ type: 'date' }) fx_date: string;
  @Column({ type: 'varchar', length: 20 }) fx_source: string;
  @Column({ type: 'uuid', nullable: true }) fx_rate_id: string | null;

  @Column({ type: 'numeric', precision: 18, scale: 2, default: 0 }) debit_eur: string;
  @Column({ type: 'numeric', precision: 18, scale: 2, default: 0 }) credit_eur: string;

  @Column({ type: 'uuid', nullable: true }) vessel_id: string | null;
  @Column({ type: 'uuid', nullable: true }) supplier_id: string | null;
  @Column({ type: 'uuid', nullable: true }) customer_id: string | null;
  @Column({ type: 'uuid', nullable: true }) cost_center_id: string | null;

  @Column({ type: 'varchar', length: 500, nullable: true }) description: string | null;
  @CreateDateColumn({ type: 'timestamptz' }) created_at: Date;

  @ManyToOne(() => JournalEntry, (e) => e.lines, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'entry_id', foreignKeyConstraintName: FK_JL_ENTRY })
  entry: JournalEntry;

  @ManyToOne(() => AccountingAccount, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'account_id', foreignKeyConstraintName: FK_JL_ACCOUNT })
  account: AccountingAccount;

  @ManyToOne(() => AccountingFxRate, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'fx_rate_id', foreignKeyConstraintName: FK_JL_FX_RATE })
  fx_rate_ref: AccountingFxRate | null;

  @ManyToOne(() => CostCenter, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'cost_center_id', foreignKeyConstraintName: FK_JL_COST_CENTER })
  cost_center: CostCenter | null;
}
