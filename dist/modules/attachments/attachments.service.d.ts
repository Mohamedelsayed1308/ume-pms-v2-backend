import { Repository } from 'typeorm';
import { Attachment } from './attachment.entity';
export declare class AttachmentsService {
    private repo;
    constructor(repo: Repository<Attachment>);
    create(invoiceId: string, file: Express.Multer.File): Promise<{
        invoice_id: string;
        original_name: string;
        filename: string;
        mimetype: string;
        size: number;
    } & Attachment>;
    findByInvoice(invoiceId: string): Promise<Attachment[]>;
    remove(id: string): Promise<{
        deleted: boolean;
    }>;
}
