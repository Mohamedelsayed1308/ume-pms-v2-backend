import { Invoice } from '../invoices/invoice.entity';
export declare class Attachment {
    id: string;
    invoice_id: string;
    original_name: string;
    filename: string;
    mimetype: string;
    size: number;
    created_at: Date;
    invoice: Invoice;
}
