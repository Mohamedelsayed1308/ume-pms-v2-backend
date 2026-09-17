import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  email: string;

  @Column()
  password: string;

  @Column({ length: 100 })
  full_name: string;

  // الافتراضي الآمن = user. لا يصبح أي مستخدم أدمن إلا بتعيين صريح.
  @Column({ default: 'user' })
  role: string;

  @Column({ default: true })
  is_active: boolean;

  // الشاشات المسموح للمستخدم بدخولها (مسارات) — null/فارغ + دور admin = كل الشاشات
  @Column({ type: 'jsonb', nullable: true })
  allowed_screens: string[];

  /*
   * جلسةٌ واحدةٌ سارية.
   *
   * الرمز يحمل `sid`، والحارس يقارنه بهذا العمود. فالدخول الجديد يكتب رقماً
   * جديداً ويُسقط رمز الجهاز القديم عند أوّل طلب.
   *
   * و`null` يعني **لا جلسة مثبَّتة** فتُقبل الرموز القائمة — وهي حال كلّ
   * الحسابات بعد الهجرة مباشرةً، فلا يخرج أحدٌ بسببها.
   */
  @Column({ length: 64, nullable: true })
  session_id: string;

  @Column({ type: 'timestamptz', nullable: true })
  session_started_at: Date;

  @CreateDateColumn()
  created_at: Date;
}
