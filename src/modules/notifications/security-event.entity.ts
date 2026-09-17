import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

/** أنواع الأحداث الأمنيّة — نصٌّ ثابتٌ يُخزَّن كما هو. */
export const SECURITY_EVENT = {
  SESSION_REVOKED_NEW_LOGIN: 'SESSION_REVOKED_NEW_LOGIN',
} as const;

/**
 * حادثةٌ أمنيّةٌ واحدة — تُكتب مرّةً واحدةً لحظةَ وقوعها.
 *
 * وبياناتُ الحساب لقطةٌ لا رابط: لو تغيّر اسم المستخدم أو بريده بعدها بقي
 * السجلّ صادقاً عمّا جرى وقتها.
 */
@Entity('security_events')
export class SecurityEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ length: 64 })
  event_type: string;

  @Column({ type: 'uuid' })
  user_id: string;

  @Column({ length: 255, nullable: true })
  user_email: string;

  @Column({ length: 100, nullable: true })
  user_name: string;

  @Column({ length: 64, nullable: true })
  ip: string;

  @Column({ type: 'text', nullable: true })
  user_agent: string;

  /** وصفٌ مبسَّطٌ للمتصفّح والنظام — مشتقٌّ من `user_agent`. */
  @Column({ length: 120, nullable: true })
  device: string;

  /** بداية الجلسة التي أُنهيت — فارغٌ إن لم تكن ثمّة جلسةٌ سابقة. */
  @Column({ type: 'timestamptz', nullable: true })
  prev_session_started_at: Date;

  @CreateDateColumn({ type: 'timestamptz' })
  occurred_at: Date;
}
