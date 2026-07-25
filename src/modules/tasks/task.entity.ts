import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, OneToMany } from 'typeorm';
import { TaskComment } from './task-comment.entity';

@Entity('tasks')
export class Task {
  @PrimaryGeneratedColumn('uuid') id: string;

  @Column({ length: 300 }) title: string;
  @Column({ type: 'text', nullable: true }) reason: string;
  @Column({ type: 'text', nullable: true }) notes: string;

  @Column({ length: 100, default: 'UME' }) team: string;
  @Column({ length: 100, nullable: true }) owner: string;
  @Column({ length: 100, nullable: true }) recommended_employee: string;

  @Column({ length: 20, default: 'medium' }) priority: string;  // low | medium | high | urgent
  @Column({ length: 30, default: 'pending' }) status: string;   // pending | in_progress | done | cancelled

  @Column({ type: 'date', nullable: true }) due_date: string;

  @Column({ length: 20, default: 'none' }) recurrence: string;  // none | daily | weekly | monthly
  @Column({ type: 'date', nullable: true }) recurrence_next: string;

  @OneToMany(() => TaskComment, (c) => c.task, { cascade: true })
  comments: TaskComment[];

  @CreateDateColumn() created_at: Date;
  @UpdateDateColumn() updated_at: Date;
}
