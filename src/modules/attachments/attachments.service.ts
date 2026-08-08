import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Attachment } from './attachment.entity';
import { createClient } from '@supabase/supabase-js';
import * as path from 'path';

// المفتاح والرابط من البيئة فقط (لا قيمة مكتوبة). يفشل بأمان لو غابا.
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  throw new Error('SUPABASE_URL and SUPABASE_SERVICE_KEY environment variables are required (no hardcoded fallback).');
}
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

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
