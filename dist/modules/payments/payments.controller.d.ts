import { PaymentsService } from './payments.service';
export declare class PaymentsController {
    private svc;
    constructor(svc: PaymentsService);
    findAll(): Promise<import("./payment.entity").Payment[]>;
    byInvoice(id: string): Promise<import("./payment.entity").Payment[]>;
    findOne(id: string): Promise<import("./payment.entity").Payment | null>;
    create(body: any): Promise<Partial<import("./payment.entity").Payment> & import("./payment.entity").Payment>;
    remove(id: string): Promise<{
        deleted: boolean;
    }>;
}
