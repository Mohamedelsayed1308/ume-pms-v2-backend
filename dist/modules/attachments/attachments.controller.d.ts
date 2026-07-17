import { AttachmentsService } from './attachments.service';
export declare class AttachmentsController {
    private svc;
    constructor(svc: AttachmentsService);
    upload(invoiceId: string, file: Express.Multer.File): Promise<{
        invoice_id: string;
        original_name: string;
        filename: string;
        mimetype: string;
        size: number;
    } & import("./attachment.entity").Attachment>;
    findByInvoice(id: string): Promise<import("./attachment.entity").Attachment[]>;
    remove(id: string): Promise<{
        deleted: boolean;
    }>;
}
