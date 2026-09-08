import { Entity, PrimaryGeneratedColumn, Column, Index } from 'typeorm';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * مصاريف المركب من دفتر الشركة (QuickBooks COGS) — لكارت الربحيّة
 *
 * ── لماذا جدولٌ مستقلّ لا جدول الفواتير ──
 * جدول `invoices` هو دورة الدفع: غير مسدَّد ← اعتماد ← سداد ← كشف مورّد. وهذه
 * القيود **سُدّدت في QuickBooks أصلاً**، وإدخالها هناك يُظهرها ديوناً مستحقّة
 * ويُلوّث كشوف المورّدين وتنبيهات الاستحقاق. فلها جدولها، والكارت يقرأ الاثنين.
 *
 * ── والدولار من الملفّ لا من تحويلٍ هنا ──
 * دفتر QuickBooks باليورو، وعموده `USD` = المبلغ × 1.15 ثابتاً — لكنّه يُعيد
 * الدولار الأصليّ في كلّ فاتورةٍ بالسنت (15,000 للإدارة الفنّيّة تخرج 15,000.00).
 * فيُحفظ كما جاء، ومعه مبلغ الدفتر وعملته للمراجعة.
 *
 * ── والقيد المستبعَد يبقى ──
 * ما لا يُحمَّل على الكارت (المياه العذبة لأنّها في دفتر الرحلات، وأقساط
 * التأمين لأنّ الوثيقة هي المرجع، وإهلاك الدراي دوك الشهريّ لأنّ سطراً
 * سنويّاً يحلّ محلّه) **يُحفظ بعلامة `charged = false` وسببها**، فلا يعود في
 * الاستيراد التالي جديداً، ويُقرأ لماذا غاب.
 *
 * ── والنوع الصريح في كلّ عمودٍ يقبل الفراغ ──
 * عمودٌ بنوعٍ اتّحاديّ بلا `type:` يُسقط الخدمة عند بناء البيانات الوصفيّة —
 * سقط الإنتاج بهذا فعلاً.
 * ═══════════════════════════════════════════════════════════════════════════
 */
@Entity('vessel_cogs_entries')
export class VesselCogsEntry {
  @PrimaryGeneratedColumn('uuid') id: string;

  /** اسم السفينة كما في جدول `vessels` — حرفاً بحرف */
  @Index()
  @Column({ type: 'varchar', length: 120 }) vessel: string;

  @Column({ type: 'varchar', length: 20, default: 'quickbooks' }) source: 'quickbooks' | 'policy' | 'manual';

  /** بصمة القيد — تمنع تكراره عند إعادة استيراد الملفّ الشهريّ */
  @Column({ type: 'varchar', length: 64, unique: true }) dedupe_key: string;

  @Column({ type: 'varchar', length: 60, default: '' }) batch_code: string;

  @Column({ type: 'varchar', length: 20, default: '' }) account_code: string;
  @Column({ type: 'varchar', length: 200, default: '' }) account_path: string;
  @Column({ type: 'varchar', length: 30, default: '' }) doc_type: string;

  @Index()
  @Column({ type: 'date' }) entry_date: string;
  @Column({ type: 'varchar', length: 100, default: '' }) doc_number: string;
  @Column({ type: 'varchar', length: 200, default: '' }) supplier: string;
  @Column({ type: 'text', default: '' }) memo: string;

  @Column({ type: 'numeric', precision: 15, scale: 2 }) amount_usd: string;
  @Column({ type: 'numeric', precision: 15, scale: 2, nullable: true }) amount_book: string | null;
  @Column({ type: 'varchar', length: 10, default: 'EUR' }) book_currency: string;

  @Column({ type: 'varchar', length: 40 }) category: string;
  @Column({ type: 'varchar', length: 120 }) item_label: string;
  /** فارغ = تُحمَّل كاملةً في شهرها */
  @Column({ type: 'smallint', nullable: true }) depreciation_months: number | null;

  @Column({ type: 'boolean', default: true }) charged: boolean;
  @Column({ type: 'varchar', length: 200, default: '' }) exclude_reason: string;
  @Column({ type: 'text', default: '' }) note: string;

  @Column({ type: 'varchar', length: 120, default: '' }) created_by: string;
  @Column({ type: 'timestamptz', default: () => 'now()' }) created_at: Date;
}
