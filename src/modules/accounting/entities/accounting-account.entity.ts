import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn, Index, Check } from 'typeorm';
import { LegalEntity } from './legal-entity.entity';
import {
  FK_ACCT_ENTITY, FK_ACCT_PARENT, UQ_ACCT_CODE, UQ_ACCT_ROLE,
  CHK_ACCT_TYPE, CHK_ACCT_TYPE_EXPR, CHK_ACCT_NORMAL, CHK_ACCT_NORMAL_EXPR,
} from '../accounting.constants';

/**
 * دليل الحسابات.
 *
 * ثلاثة مفاهيم منفصلة عمداً:
 *   account_type   التصنيف المحاسبي — يحدد القوائم المالية
 *   account_group  تجميع للعرض والتقارير
 *   system_role    مفتاح دلالي يطلبه منطق الأعمال — nullable
 *
 * **لا سطر كود واحد يقرأ `code`.** المنطق يطلب system_role، فتغيير أرقام الدليل
 * عند اعتماد COA النهائي لا يكسر شيئاً — وهذا ما يجعل الأرقام الحالية مؤقتة بأمان.
 */
@Entity('accounting_accounts')
@Check(CHK_ACCT_TYPE, CHK_ACCT_TYPE_EXPR)
@Check(CHK_ACCT_NORMAL, CHK_ACCT_NORMAL_EXPR)
@Index(UQ_ACCT_CODE, ['legal_entity_id', 'code'], { unique: true })
@Index(UQ_ACCT_ROLE, ['legal_entity_id', 'system_role'], { unique: true, where: 'system_role IS NOT NULL' })
export class AccountingAccount {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ type: 'uuid' }) legal_entity_id: string;

  @Column({ type: 'varchar', length: 20 }) code: string;                    // مؤقّت حتى اعتماد COA
  @Column({ type: 'varchar', length: 200 }) name: string;
  @Column({ type: 'varchar', length: 200, nullable: true }) name_ar: string | null;

  @Column({ type: 'varchar', length: 20 }) account_type: string;
  @Column({ type: 'varchar', length: 60, nullable: true }) account_group: string | null;
  @Column({ type: 'varchar', length: 40, nullable: true }) system_role: string | null;
  @Column({ type: 'varchar', length: 6 }) normal_balance: string;

  @Column({ type: 'uuid', nullable: true }) parent_id: string | null;
  @Column({ type: 'smallint', default: 1 }) level: number;

  /** حسابات العناوين تجميعية — الترحيل عليها مرفوض. */
  @Column({ type: 'boolean', default: true }) is_postable: boolean;

  /** خطّاف إعادة التقييم المستقبلية: البنود النقدية وحدها تُعاد تقييمها بسعر الإقفال. */
  @Column({ type: 'boolean', default: false }) is_monetary: boolean;

  /** يفصل أرصدة الأطراف المرتبطة عن الذمم التجارية بنيوياً لا بالاجتهاد. */
  @Column({ type: 'boolean', default: false }) is_related_party: boolean;

  /** حساب مراقبة: الرصيد الإجمالي وحده لا يكفي — يلزمه دفتر مساعد. */
  @Column({ type: 'boolean', default: false }) requires_subledger: boolean;

  @Column({ type: 'varchar', length: 3, nullable: true }) currency_restriction: string | null;
  @Column({ type: 'boolean', default: true }) is_active: boolean;
  @CreateDateColumn({ type: 'timestamptz' }) created_at: Date;
  @UpdateDateColumn({ type: 'timestamptz' }) updated_at: Date;

  @ManyToOne(() => LegalEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'legal_entity_id', foreignKeyConstraintName: FK_ACCT_ENTITY })
  legal_entity: LegalEntity;

  @ManyToOne(() => AccountingAccount, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'parent_id', foreignKeyConstraintName: FK_ACCT_PARENT })
  parent: AccountingAccount | null;
}
