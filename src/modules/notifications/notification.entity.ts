import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

export const NOTIF_KIND = { SECURITY: 'SECURITY' } as const;

/**
 * إشعارٌ محفوظٌ لمستلِمٍ واحد.
 *
 * ── ولماذا جدولٌ أصلاً ──
 * مركز التنبيهات يشتقّ ما يعرضه في المتصفّح من الفواتير والمهامّ، فلا يصل
 * الأدمن شيءٌ إن كان خارج المنظومة وقت الحادثة. وهذا الجدول للأحداث التي
 * **لا تُشتقّ** من بيانات قائمة — تُكتب حين تقع وتنتظر صاحبها.
 *
 * ومنعُ التكرار بالبناء لا بالشرط: فهرسٌ فريدٌ على (`user_id`, `event_id`).
 */
@Entity('notifications')
@Index(['user_id', 'created_at'])
export class Notification {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  user_id: string;

  @Column({ type: 'uuid', nullable: true })
  event_id: string;

  @Column({ length: 32 })
  kind: string;

  @Column({ length: 64 })
  event_type: string;

  @Column({ length: 16, default: 'critical' })
  severity: string;

  @Column({ length: 200 })
  title: string;

  @Column({ type: 'text', nullable: true })
  body: string;

  @Column({ type: 'jsonb', nullable: true })
  data: Record<string, any>;

  @Column({ default: false })
  is_read: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at: Date;
}
