import { Repository } from 'typeorm';
import { Payment } from './payment.entity';
import { InvoicesService } from '../invoices/invoices.service';
export declare class PaymentsService {
    private repo;
    private invoicesService;
    constructor(repo: Repository<Payment>, invoicesService: InvoicesService);
    findAll(): Promise<Payment[]>;
    findOne(id: string): Promise<Payment | null>;
    findByInvoice(invoiceId: string): Promise<Payment[]>;
    create(data: Partial<Payment>): Promise<Partial<Payment> & Payment>;
    remove(id: string): Promise<{
        deleted: boolean;
    }>;
}
