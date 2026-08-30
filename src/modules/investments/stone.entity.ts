import { Entity, PrimaryGeneratedColumn, Column, Index } from 'typeorm';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * كارت متابعة استثمار Stone Shipping
 *
 * دورةٌ رباعيّةٌ بين ثلاث جهات:
 *
 *   UME Holdings ──① تغذية ──▶ Bee Shipping ──② مساهمة ──▶ Stone
 *      (الأمّ)   ◀── ④ سداد ──   (التابعة)   ◀── ③ استرداد ──
 *                     + فائدة
 *
 * ── ولماذا دفترٌ مستقلّ ──
 * لا كيانَ محاسبيّاً لـ Bee ولا لـ UME Holdings في النظام، وأمر المالك أن
 * يكون «دفتراً بسيطاً». فلا `legal_entity` ولا قيود `GJ`: هذه الجداول تحمل
 * الحقيقة، وقيدٌ خاطئٌ فيها يُصحَّح ولا يلوّث دفتر المجموعة.
 *
 * ── والنوع الصريح في كلّ عمودٍ يقبل الفراغ ──
 * عمودٌ بنوعٍ اتّحاديّ (`string | null`) بلا `type:` يُسقط الخدمة **عند بناء
 * البيانات الوصفيّة** — قبل أن تتّصل بالقاعدة. وقد سقط الإنتاج بهذا فعلاً.
 * ═══════════════════════════════════════════════════════════════════════════
 */

/** جولةُ استثمارٍ — بياناً لا كوداً، فالتاسعة سطرٌ يُدخَل لا نشرةٌ تُطلَق. */
@Entity('stone_rounds')
export class StoneRound {
  @PrimaryGeneratedColumn('uuid') id: string;

  @Column({ type: 'smallint', unique: true }) round_no: number;
  @Column({ type: 'numeric', precision: 18, scale: 2 }) commitment_usd: string;
  @Column({ type: 'date', nullable: true }) plsa_signed_date: string | null;
  @Column({ type: 'varchar', length: 60, default: '' }) status: string;
  @Column({ type: 'text', default: '' }) note: string;
  @Column({ type: 'timestamptz', default: () => 'now()' }) created_at: Date;
  @Column({ type: 'timestamptz', default: () => 'now()' }) updated_at: Date;
}

/**
 * دفتر الأمّ — UME Holdings ↔ Bee Shipping.
 *
 * حركةٌ واحدةٌ يُحدّد معناها حقلان:
 *   `direction` تغذيةٌ نزولاً أم سدادٌ صعوداً
 *   `kind`      أصلٌ يُنقص المديونيّة أم فائدةٌ تُتابَع منفصلة
 *
 * **والمبلغ موجبٌ دائماً** — الاتّجاه يحمل الإشارة. فعمودٌ فيه سالبٌ وموجبٌ
 * يعني أمرين لمن يقرأه، والفصلُ يقطع اللبس.
 *
 * والرصيد **يُشتقّ ولا يُخزَّن**: `القائم = Σ تغذية − Σ سداد أصل`. فلا رقمَ
 * محفوظٌ يستطيع أن يخالف مكوّناته.
 */
@Entity('stone_parent_ledger')
export class StoneParentLedger {
  @PrimaryGeneratedColumn('uuid') id: string;

  @Index()
  @Column({ type: 'date' }) occurred_at: string;
  @Column({ type: 'varchar', length: 20 }) direction: 'funding' | 'repayment';
  @Column({ type: 'varchar', length: 20, default: 'principal' }) kind: 'principal' | 'interest';
  @Column({ type: 'numeric', precision: 18, scale: 2 }) amount_usd: string;
  @Column({ type: 'uuid', nullable: true }) round_id: string | null;
  @Column({ type: 'varchar', length: 160, default: '' }) reference: string;
  @Column({ type: 'text', default: '' }) note: string;
  @Column({ type: 'varchar', length: 120, default: '' }) created_by: string;
  @Column({ type: 'timestamptz', default: () => 'now()' }) created_at: Date;
}

/**
 * دفتر الاستثمار — Bee ↔ Stone.
 *
 * ── تاريخان لا واحد ──
 * شيت Stone وسجلّ Bee يحملان المبالغ نفسها بتواريخ تختلف من صفرٍ إلى اثني عشر
 * يوماً (متوسّطها ٤.٨). فالأوّل تاريخ **النداء** والثاني تاريخ **الدفع**، وحفظُ
 * واحدٍ يجعل التوفيق بين المصدرين مستحيلاً.
 *
 * ── و`source` يُبقي الفجوة مرئيّة ──
 * شيت Stone: ١٩ قيداً بمجموع 1,137,500 — وهو ٩١٪ من الالتزام بالدولار الواحد،
 * مطابقٌ لما نادى به الصندوق. ودفتر Bee: ٢٢ بمجموع 1,272,500.
 *
 * **ودفتر Bee يفوز عند التعارض** بقرار المالك — لكنّ الفجوة تُعرض ولا تُخفى:
 * هي التي كشفت أنّ القيود الثلاثة الزائدة تُطابق أقساط الجولة ٨ مبلغاً بفارق
 * ٦–٨ أيام. و`suspect_round_id` يُعلن ذلك الشكّ **ولا ينقل قيداً** — النقل
 * بيد المالك وحده.
 */
@Entity('stone_investment_ledger')
export class StoneInvestmentLedger {
  @PrimaryGeneratedColumn('uuid') id: string;

  @Index()
  @Column({ type: 'uuid' }) round_id: string;
  @Column({ type: 'varchar', length: 20 }) direction: 'contribution' | 'repatriation';
  @Column({ type: 'smallint', nullable: true }) seq: number | null;
  /** تاريخ نداء المساهمة — من سجلّ Stone */
  @Column({ type: 'date', nullable: true }) call_date: string | null;
  /** تاريخ الدفع الفعليّ — من دفتر Bee */
  @Column({ type: 'date', nullable: true }) paid_date: string | null;
  @Column({ type: 'numeric', precision: 18, scale: 2 }) amount_usd: string;
  @Column({ type: 'numeric', precision: 9, scale: 6, nullable: true }) pct_of_commitment: string | null;
  @Column({ type: 'varchar', length: 240, default: '' }) ships: string;
  @Column({ type: 'varchar', length: 20, default: 'both' }) source: 'stone_recap' | 'bee_gl' | 'both';
  /** الاسترداد وحده يحمل حالة — والمساهمة تتركها فارغة */
  @Column({ type: 'varchar', length: 20, nullable: true }) status: 'announced' | 'confirmed' | null;
  @Column({ type: 'uuid', nullable: true }) suspect_round_id: string | null;
  @Column({ type: 'text', default: '' }) note: string;
  @Column({ type: 'varchar', length: 120, default: '' }) created_by: string;
  @Column({ type: 'timestamptz', default: () => 'now()' }) created_at: Date;
}

/**
 * تأكيد تحويلٍ بنكيّ — سجلٌّ مستقلّ بأمر المالك.
 *
 * فتأكيدٌ واحدٌ قد يغطّي أكثر من قيد، وجعلُه حقلاً على القيد يُجبر على تكرار
 * المرجع. والربط اختياريّ: تأكيدٌ يصل قبل أن يُقيَّد ما يؤكّده يُحفظ ويُربط بعد.
 */
@Entity('stone_bank_confirmations')
export class StoneBankConfirmation {
  @PrimaryGeneratedColumn('uuid') id: string;

  @Column({ type: 'date' }) occurred_at: string;
  @Column({ type: 'varchar', length: 160, default: '' }) bank: string;
  @Column({ type: 'varchar', length: 200, default: '' }) reference: string;
  @Column({ type: 'numeric', precision: 18, scale: 2, nullable: true }) amount_usd: string | null;
  @Column({ type: 'varchar', length: 30, nullable: true }) links_table: 'parent_ledger' | 'investment_ledger' | null;
  @Column({ type: 'uuid', nullable: true }) links_id: string | null;
  @Column({ type: 'text', default: '' }) note: string;
  @Column({ type: 'varchar', length: 120, default: '' }) created_by: string;
  @Column({ type: 'timestamptz', default: () => 'now()' }) created_at: Date;
}

/** «الصندوق نادى كذا٪ بتاريخ كذا» — المقياس الذي كشف تناسب سجلّ Stone. */
@Entity('stone_fund_calls')
export class StoneFundCall {
  @PrimaryGeneratedColumn('uuid') id: string;

  @Column({ type: 'uuid' }) round_id: string;
  @Column({ type: 'date' }) as_of: string;
  @Column({ type: 'numeric', precision: 18, scale: 2, nullable: true }) fund_called_usd: string | null;
  @Column({ type: 'numeric', precision: 9, scale: 6, nullable: true }) pct: string | null;
  @Column({ type: 'text', default: '' }) note: string;
  @Column({ type: 'timestamptz', default: () => 'now()' }) created_at: Date;
}

/** سفينةٌ أُضيفت للجولة. */
@Entity('stone_vessels')
export class StoneVessel {
  @PrimaryGeneratedColumn('uuid') id: string;

  @Column({ type: 'uuid', nullable: true }) round_id: string | null;
  @Column({ type: 'varchar', length: 160 }) name: string;
  @Column({ type: 'varchar', length: 120, default: '' }) vessel_type: string;
  @Column({ type: 'smallint', nullable: true }) built: number | null;
  @Column({ type: 'varchar', length: 120, default: '' }) hire: string;
  @Column({ type: 'varchar', length: 120, default: '' }) charter_period: string;
  @Column({ type: 'varchar', length: 120, default: '' }) delivery: string;
  @Column({ type: 'varchar', length: 120, default: '' }) pool_coefficient: string;
  @Column({ type: 'text', default: '' }) note: string;
  @Column({ type: 'timestamptz', default: () => 'now()' }) created_at: Date;
}

/**
 * بندٌ مفتوح.
 *
 * أحد عشر بنداً في مستند المالك بلا حالةٍ لأيٍّ منها — وقائمةٌ بلا حالةٍ تُقرأ
 * ولا تتحرّك. فأُضيفت الحالة والمسؤول والتاريخ.
 */
@Entity('stone_open_items')
export class StoneOpenItem {
  @PrimaryGeneratedColumn('uuid') id: string;

  @Column({ type: 'text' }) title: string;
  @Column({ type: 'varchar', length: 20, default: 'open' }) status: 'open' | 'sent' | 'closed';
  @Column({ type: 'varchar', length: 160, default: '' }) owner: string;
  @Column({ type: 'date', nullable: true }) due_date: string | null;
  @Column({ type: 'date', nullable: true }) closed_date: string | null;
  @Column({ type: 'text', default: '' }) note: string;
  @Column({ type: 'smallint', default: 0 }) sort_order: number;
  @Column({ type: 'timestamptz', default: () => 'now()' }) created_at: Date;
  @Column({ type: 'timestamptz', default: () => 'now()' }) updated_at: Date;
}

/**
 * شروط الفائدة.
 *
 * ── والفراغ لا يُقرأ إقراراً ──
 * الجدولُ فارغٌ اليوم، ومستند المالك يقول التسهيل بلا فائدةٍ ويُنبّه أنّ المادّة
 * ٣٣ القبرصيّة قد تفرض فائدةً حكميّة. فما دام لا سطرَ هنا **تقول الشاشة صراحةً
 * «لا فائدةَ مُتّفقٌ عليها»** — لا تسكت.
 *
 * و`is_agreed = false` يعني شرطاً يُحسب به **تقديرٌ يُعرض ولا يُقيَّد**. ولا
 * يدخل قيدُ فائدةٍ دفترَ الأمّ إلا بمصادقةٍ صريحة — بقرار المالك في ٢٨ أغسطس.
 */
@Entity('stone_interest_terms')
export class StoneInterestTerm {
  @PrimaryGeneratedColumn('uuid') id: string;

  @Column({ type: 'date' }) effective_from: string;
  @Column({ type: 'numeric', precision: 9, scale: 4 }) rate_pct: string;
  @Column({ type: 'varchar', length: 20, default: 'ACT/365' }) day_count: string;
  @Column({ type: 'boolean', default: false }) is_agreed: boolean;
  @Column({ type: 'text', default: '' }) note: string;
  @Column({ type: 'varchar', length: 120, default: '' }) created_by: string;
  @Column({ type: 'timestamptz', default: () => 'now()' }) created_at: Date;
}
