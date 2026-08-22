import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('profit_periods')
export class ProfitPeriod {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ length: 200 })
  period_name: string;

  @Column({ type: 'date' })
  date_from: string;

  @Column({ type: 'date' })
  date_to: string;

  // ── إيرادات العبارات (من Excel أو يدوي) ──────────────────────────────
  @Column({ type: 'decimal', precision: 15, scale: 4, default: 0 }) poseidon_revenue: number;
  @Column({ type: 'decimal', precision: 15, scale: 4, default: 0 }) amal_revenue: number;
  @Column({ type: 'decimal', precision: 15, scale: 4, default: 0 }) daleela_revenue: number;

  @Column({ type: 'int', default: 0 }) poseidon_voyages: number;
  @Column({ type: 'int', default: 0 }) amal_voyages: number;
  @Column({ type: 'int', default: 0 }) daleela_voyages: number;

  @Column({ type: 'decimal', precision: 15, scale: 4, default: 0 }) poseidon_over_pax: number;
  @Column({ type: 'decimal', precision: 15, scale: 4, default: 0 }) amal_over_pax: number;
  @Column({ type: 'decimal', precision: 15, scale: 4, default: 0 }) daleela_over_pax: number;

  // ── بنكر (مجلوب من الشيت) ─────────────────────────────────────────────
  @Column({ type: 'decimal', precision: 15, scale: 4, default: 0 }) bunker_badawi: number;
  @Column({ type: 'decimal', precision: 15, scale: 4, default: 0 }) bunker_ittihad: number;

  /* ═══════════════════════════════════════════════════════════════════════
   * مدخلات معادلة المستند المعتمد
   *
   * الحقول أعلاه كُتبت لمعادلةٍ تبدأ من الإيراد وتُجمّع الشريكين في عمودين
   * («بدوي» و«الاتحاد»). والمستند يبدأ من النقد ويعمل على المراكب فرادى.
   * فأُضيفت الحقول التالية بدل تحميل القديمة معنىً لا تحمله — وبقيت القديمة
   * كما هي لأنّ فتراتٍ محفوظةً تعتمد عليها، ولأنّ حذف عمودٍ فيه أرقامُ توزيعٍ
   * سابق ليس تنظيفاً بل إتلاف.
   *
   * لكلّ مركب:
   *   sd_base       أساس العمولة — مجموع `trE` من دفتر الرحلات
   *   sd_adjust     تعديلٌ يدويّ عليه، يستوجب سبباً في adjust_reason
   *   fuel          الوقود — مجموع `bnk`
   *   fuel_adjust   تعديلٌ يدويّ عليه
   *   cash_duba     النقد المتاح في ضبا — رصيد خزينةٍ فعليّ، أساس التوزيع كلّه
   *   net_collected صافي التحصيل في صفاجا — تقوم عليه تسوية صفاجا
   *   daily_rate    السعر اليوميّ للإيجار
   *   liquidity     سيولة الدفتر `liq` — تُخزَّن للمقارنة لا للحساب
   * ═════════════════════════════════════════════════════════════════════ */

  @Column({ type: 'decimal', precision: 15, scale: 4, default: 0 }) poseidon_sd_base: number;
  @Column({ type: 'decimal', precision: 15, scale: 4, default: 0 }) poseidon_sd_adjust: number;
  @Column({ type: 'decimal', precision: 15, scale: 4, default: 0 }) poseidon_fuel: number;
  @Column({ type: 'decimal', precision: 15, scale: 4, default: 0 }) poseidon_fuel_adjust: number;
  @Column({ type: 'decimal', precision: 15, scale: 4, default: 0 }) poseidon_cash_duba: number;
  @Column({ type: 'decimal', precision: 15, scale: 4, default: 0 }) poseidon_net_collected: number;
  @Column({ type: 'decimal', precision: 15, scale: 4, default: 0 }) poseidon_liquidity: number;
  @Column({ type: 'decimal', precision: 12, scale: 2, default: 14000 }) poseidon_daily_rate: number;

  @Column({ type: 'decimal', precision: 15, scale: 4, default: 0 }) amal_sd_base: number;
  @Column({ type: 'decimal', precision: 15, scale: 4, default: 0 }) amal_sd_adjust: number;
  @Column({ type: 'decimal', precision: 15, scale: 4, default: 0 }) amal_fuel: number;
  @Column({ type: 'decimal', precision: 15, scale: 4, default: 0 }) amal_fuel_adjust: number;
  @Column({ type: 'decimal', precision: 15, scale: 4, default: 0 }) amal_cash_duba: number;
  @Column({ type: 'decimal', precision: 15, scale: 4, default: 0 }) amal_net_collected: number;
  @Column({ type: 'decimal', precision: 15, scale: 4, default: 0 }) amal_liquidity: number;
  @Column({ type: 'decimal', precision: 12, scale: 2, default: 13000 }) amal_daily_rate: number;

  @Column({ type: 'decimal', precision: 15, scale: 4, default: 0 }) daleela_sd_base: number;
  @Column({ type: 'decimal', precision: 15, scale: 4, default: 0 }) daleela_sd_adjust: number;
  @Column({ type: 'decimal', precision: 15, scale: 4, default: 0 }) daleela_fuel: number;
  @Column({ type: 'decimal', precision: 15, scale: 4, default: 0 }) daleela_fuel_adjust: number;
  @Column({ type: 'decimal', precision: 15, scale: 4, default: 0 }) daleela_cash_duba: number;
  @Column({ type: 'decimal', precision: 15, scale: 4, default: 0 }) daleela_net_collected: number;
  @Column({ type: 'decimal', precision: 15, scale: 4, default: 0 }) daleela_liquidity: number;
  @Column({ type: 'decimal', precision: 12, scale: 2, default: 12000 }) daleela_daily_rate: number;

  /**
   * تسوية إيقاف المركب — بندٌ في المستند لم يُرَ إلا صفراً.
   * يُخزَّن ولا يُحتسب: موضعه في السلسلة غير معروف، والتخمين هنا يمسّ مالاً.
   */
  @Column({ type: 'decimal', precision: 15, scale: 4, default: 0 }) poseidon_off_hire: number;
  @Column({ type: 'decimal', precision: 15, scale: 4, default: 0 }) amal_off_hire: number;
  @Column({ type: 'decimal', precision: 15, scale: 4, default: 0 }) daleela_off_hire: number;

  /** سبب التعديل اليدويّ على الأساس أو الوقود. لا تسويةَ بلا سبب. */
  @Column({ type: 'text', nullable: true }) adjust_reason: string;

  // ── مدخلات يدوية ──────────────────────────────────────────────────────
  @Column({ type: 'decimal', precision: 15, scale: 4, default: 0 }) poseidon_rent: number;
  @Column({ type: 'decimal', precision: 15, scale: 4, default: 0 }) amal_rent: number;
  @Column({ type: 'decimal', precision: 15, scale: 4, default: 0 }) daleela_rent: number;

  // العمولة الإجمالية المجلوبة من الشيت (تحل محل حساب النسبة %)
  @Column({ type: 'decimal', precision: 15, scale: 4, default: 0 }) commission_amount: number;

  @Column({ type: 'decimal', precision: 15, scale: 4, default: 0 }) cash_safaga_badawi: number;
  @Column({ type: 'decimal', precision: 15, scale: 4, default: 0 }) cash_safaga_ittihad: number;

  @Column({ type: 'decimal', precision: 15, scale: 4, default: 0 }) transfers_badawi: number;
  @Column({ type: 'decimal', precision: 15, scale: 4, default: 0 }) transfers_ittihad: number;

  // ── نسب التوزيع ───────────────────────────────────────────────────────
  @Column({ type: 'decimal', precision: 5, scale: 2, default: 50 }) ratio_badawi: number;
  @Column({ type: 'decimal', precision: 5, scale: 2, default: 50 }) ratio_ittihad: number;

  // ── معاملات الحساب ────────────────────────────────────────────────────
  @Column({ type: 'decimal', precision: 5, scale: 2, default: 6.5 }) commission_rate: number;
  @Column({ type: 'decimal', precision: 10, scale: 2, default: 500 }) per_voyage_fee: number;

  // ── الرصيد المنقول من الفترة السابقة (تراكمي تلقائي) ────────────────
  @Column({ type: 'decimal', precision: 15, scale: 4, default: 0 }) balance_prev_badawi: number;
  @Column({ type: 'decimal', precision: 15, scale: 4, default: 0 }) balance_prev_ittihad: number;

  @Column({ length: 20, default: 'draft' }) status: string;
  @Column({ type: 'text', nullable: true }) notes: string;

  @CreateDateColumn() created_at: Date;
  @UpdateDateColumn() updated_at: Date;
}
