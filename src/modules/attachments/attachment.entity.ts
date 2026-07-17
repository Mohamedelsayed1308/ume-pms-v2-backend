import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { Invoice } from '../invoices/invoice.entity';

@Entity('attachments')
export class Attachment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  invoice_id: string;

  @Column({ length: 255 })
  original_name: string;

  @Column({ length: 255 })
  filename: string;

  @Column({ length: 50 })
  mimetype: string;

  @Column({ type: 'int' })
  size: number;

  @Column({ length: 500, nullable: true })
  url: string;

  @CreateDateColumn()
  created_at: Date;

  @ManyToOne(() => Invoice)
  @JoinColumn({ name: 'invoice_id' })
  invoice: Invoice;
}
