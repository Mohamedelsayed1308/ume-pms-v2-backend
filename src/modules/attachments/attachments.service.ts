import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Attachment } from './attachment.entity';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class AttachmentsService {
  constructor(@InjectRepository(Attachment) private repo: Repository<Attachment>) {}

  async create(invoiceId: string, file: Express.Multer.File) {
    return this.repo.save({
      invoice_id: invoiceId,
      original_name: file.originalname,
      filename: file.filename,
      mimetype: file.mimetype,
      size: file.size,
    });
  }

  findByInvoice(invoiceId: string) {
    return this.repo.find({ where: { invoice_id: invoiceId }, order: { created_at: 'DESC' } });
  }

  async remove(id: string) {
    const att = await this.repo.findOneBy({ id });
    if (att) {
      const filePath = path.join(process.cwd(), 'uploads', att.filename);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      await this.repo.delete(id);
    }
    return { deleted: true };
  }
}
