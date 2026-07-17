import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Attachment } from './attachment.entity';
import { createClient } from '@supabase/supabase-js';
import * as path from 'path';

const supabase = createClient(
  'https://euzikjnyoprzkweechky.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV1emlram55b3Byemt3ZWVjaGt5Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MTg5MzMxNywiZXhwIjoyMDk3NDY5MzE3fQ.auJCCZ8qIEBPV4zYJGbD_Z0DxQ7MrUj_9x1DKzvzu_U',
);

const BUCKET = 'ume-attachments';

@Injectable()
export class AttachmentsService {
  constructor(@InjectRepository(Attachment) private repo: Repository<Attachment>) {}

  async create(invoiceId: string, file: Express.Multer.File) {
    const ext = path.extname(file.originalname);
    const storagePath = `${invoiceId}/${Date.now()}${ext}`;

    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(storagePath, file.buffer, { contentType: file.mimetype, upsert: false });

    if (error) throw new Error(`Storage upload failed: ${error.message}`);

    const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(storagePath);

    return this.repo.save({
      invoice_id: invoiceId,
      original_name: file.originalname,
      filename: storagePath,
      mimetype: file.mimetype,
      size: file.size,
      url: urlData.publicUrl,
    });
  }

  findByInvoice(invoiceId: string) {
    return this.repo.find({ where: { invoice_id: invoiceId }, order: { created_at: 'DESC' } });
  }

  async remove(id: string) {
    const att = await this.repo.findOneBy({ id });
    if (att) {
      await supabase.storage.from(BUCKET).remove([att.filename]);
      await this.repo.delete(id);
    }
    return { deleted: true };
  }
}
