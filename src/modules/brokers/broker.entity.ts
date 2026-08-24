import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

/**
 * بروكرٌ يستحقّ عمولةً على فواتير الإيجار.
 *
 * سجلٌّ مستقلّ لا موردٌ ولا شركةُ شحن: حسابه يتبع **الفواتير الصادرة** لا
 * المشتريات، ودورتُه استحقاقٌ ثمّ سداد — لا أمرَ شراءٍ ولا استلام.
 */
@Entity('brokers')
export class Broker {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index({ unique: true })
  @Column({ length: 200 })
  name: string;

  @Column({ type: 'boolean', default: true })
  active: boolean;

  @Column({ type: 'text', default: '' })
  notes: string;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;
}

/**
 * قاعدةُ استحقاق: أيّ عميلٍ ومركبٍ وبأيّ نسبة.
 *
 * ── لماذا جدولٌ لا شرطٌ في الكود ──
 * القاعدة اليوم: `Africa Morocco Links S.A` × (`Wasa Express` أو
 * `Monte Express`) × ١.٢٥٪ لكلٍّ من بروكرين. وغداً تُضاف مركبٌ أو يتغيّر
 * البروكر أو تتبدّل النسبة — وكلّها بياناتٌ لا منطق.
 *
 * و`vessel_id` فارغاً يعني **كلّ مراكب هذا العميل**.
 */
@Entity('broker_rules')
export class BrokerRule {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'uuid' })
  broker_id: string;

  @Column({ type: 'uuid' })
  customer_id: string;

  /** فارغاً: كلّ المراكب */
  @Column({ type: 'uuid', nullable: true })
  vessel_id: string | null;

  /** نسبةٌ مئويّة — ١.٢٥ تعني ١.٢٥٪ */
  @Column({ type: 'decimal', precision: 8, scale: 4 })
  rate: number;

  @Column({ type: 'varchar', length: 10, default: 'EUR' })
  currency: string;

  @Column({ type: 'boolean', default: true })
  active: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;
}

/**
 * دفترُ البروكر — حسابٌ جارٍ.
 *
 *   `due`     استحقاقٌ عن فاتورة · موجب · واحدٌ لكلّ (فاتورة · بروكر)
 *   `payment` سدادٌ · سالب · وقد يكون على دفعات
 *
 * والرصيد مجموع القيود — يُشتقّ ولا يُخزَّن، فلا يفترق عن دفتره.
 *
 * ويُحفظ مع كلّ استحقاقٍ **أساسُه ونسبتُه**: فمن يراجع بعد سنة يجد من أين
 * جاء الرقم، ولا يعيد حسابه بنسبةٍ تغيّرت بعده.
 */
@Entity('broker_ledger')
export class BrokerLedger {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'uuid' })
  broker_id: string;

  /** الفاتورة التي وُلد عنها الاستحقاق — أو التي يُسدَّد عنها */
  @Index()
  @Column({ type: 'uuid', nullable: true })
  hire_invoice_id: string | null;

  @Column({ type: 'timestamptz', default: () => 'now()' })
  occurred_at: Date;

  /** `due` أو `payment` */
  @Column({ type: 'varchar', length: 20 })
  kind: string;

  @Column({ type: 'decimal', precision: 15, scale: 2 })
  amount: number;

  @Column({ type: 'varchar', length: 10, default: 'EUR' })
  currency: string;

  /** إجمالي الفاتورة الذي حُسبت عليه العمولة */
  @Column({ type: 'decimal', precision: 15, scale: 2, default: 0 })
  base_amount: number;

  @Column({ type: 'decimal', precision: 8, scale: 4, default: 0 })
  rate: number;

  @Column({ type: 'varchar', length: 200, default: '' })
  reference: string;

  @Column({ type: 'text', default: '' })
  note: string;

  @Column({ type: 'varchar', length: 200, default: '' })
  created_by: string;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;
}
