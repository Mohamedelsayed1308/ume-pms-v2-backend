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

  @CreateDateColumn()
  created_at: Date;
}
