import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

// بنود/فئات الفاتورة (Bunker, Vessel Supplies, Salaries, Provision ...) — قابلة للتعديل
@Entity('items')
export class Item {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ length: 100, unique: true })
  name: string;

  @Column({ default: true })
  is_active: boolean;

  @CreateDateColumn()
  created_at: Date;
}
