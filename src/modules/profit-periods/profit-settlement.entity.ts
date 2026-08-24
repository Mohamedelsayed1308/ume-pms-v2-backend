import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

/**
 * دفتر الفروق — الرصيد التراكميّ للشريكين.
 *
 * ── لماذا دفترٌ لا عمود ──
 * التوزيع يصدر وفي مصاريفه مبالغ تقديريّة (رسوم ميناء مصر ١١٬٥٠٠ في كلّ رحلة
 * حتّى تصل الفاتورة). فالمُحوَّل إلى البنك صدر على تقدير، والفعليّ يأتي بعده.
 *
 * ولو خُزّن الرصيد رقماً واحداً لضاع تاريخه: يُسأل بعد سنة «من أين جاء هذا؟»
 * فلا جواب. فكلّ فرقٍ **قيدٌ** بتاريخه وفترته وسببه، وتسويته قيدٌ مقابل —
 * والرصيد مجموعُ القيود لا حقلاً يُكتب فوقه.
 *
 * ── الاصطلاح ──
 *   `delta`   فرقٌ رُصد بعد المصادقة: المحسوب الآن − المُجمَّد − ما سُوّي
 *   `applied` تسويةٌ أُدخلت في مصادقةٍ تالية — تُقفل ما قبلها
 *
 * والمجموع الجاري لشريكٍ = مجموع قيوده. فإن ساوى صفراً فلا شيء معلّق.
 *
 * وموجبٌ يعني **لصالح الشريك** — يُزاد على تحويله القادم. وسالبٌ يُخصم منه.
 */
@Entity('profit_settlements')
export class ProfitSettlement {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'uuid' })
  period_id: string;

  @Column({ type: 'timestamptz', default: () => 'now()' })
  occurred_at: Date;

  /** `badawi` (UME · بوسيدون) أو `ittihad` (أمل + دليلة) */
  @Index()
  @Column({ length: 20 })
  partner: string;

  /** موجبٌ لصالح الشريك · سالبٌ عليه */
  @Column({ type: 'decimal', precision: 15, scale: 4 })
  amount: number;

  /** `delta` أو `applied` */
  @Column({ length: 20 })
  kind: string;

  @Column({ type: 'text', default: '' })
  note: string;

  @Column({ length: 200, default: '' })
  created_by: string;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;
}

/** الشريكان — وهما وعاء الرصيد. */
export const PARTNERS = ['badawi', 'ittihad'] as const;
export type Partner = (typeof PARTNERS)[number];

export const PARTNER_NAMES: Record<Partner, string> = {
  badawi: 'UME · بدوي',
  ittihad: 'الاتحاد',
};

/**
 * أيّ شريكٍ يملك هذا المركب.
 *
 * أكّده المالك: `UME = بدوي = بوسيدون`، وما عداه للاتحاد.
 */
export function partnerOf(vesselKey: string): Partner {
  return vesselKey === 'poseidon' ? 'badawi' : 'ittihad';
}
