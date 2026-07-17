import { InvoicesService } from './invoices.service';
export declare class InvoicesController {
    private svc;
    constructor(svc: InvoicesService);
    findAll(): Promise<import("./invoice.entity").Invoice[]>;
    dueAlerts(days?: string): Promise<{
        days_until_due: number;
        is_overdue: boolean;
        id: string;
        invoice_number: string;
        supplier_id: string;
        vessel_id: string;
        po_id: string;
        type: import("./invoice.entity").InvoiceType;
        status: import("./invoice.entity").InvoiceStatus;
        currency: string;
        total_amount: number;
        paid_amount: number;
        invoice_date: Date;
        due_date: Date;
        description: string;
        notes: string;
        created_at: Date;
        updated_at: Date;
        supplier: import("../suppliers/supplier.entity").Supplier;
        vessel: import("../vessels/vessel.entity").Vessel;
        purchase_order: import("../purchase-orders/purchase-order.entity").PurchaseOrder;
        payments: import("../payments/payment.entity").Payment[];
    }[]>;
    bySupplier(id: string): Promise<import("./invoice.entity").Invoice[]>;
    byVessel(id: string): Promise<import("./invoice.entity").Invoice[]>;
    supplierStatement(id: string): Promise<{
        supplier: null;
        transactions: never[];
        summary: {
            total_debit: number;
            total_credit: number;
            balance: number;
        };
    } | {
        supplier: {
            id: string;
            name: string;
        };
        transactions: any[];
        summary: {
            total_debit: any;
            total_credit: any;
            balance: number;
        };
    }>;
    unpaidBySupplier(id: string): Promise<import("./invoice.entity").Invoice[]>;
    unpaidByVessel(id: string): Promise<import("./invoice.entity").Invoice[]>;
    findOne(id: string): Promise<import("./invoice.entity").Invoice | null>;
    create(body: any): Promise<Partial<import("./invoice.entity").Invoice> & import("./invoice.entity").Invoice>;
    update(id: string, body: any): Promise<import("./invoice.entity").Invoice | null>;
    remove(id: string): Promise<{
        deleted: boolean;
    }>;
}
