import { Repository } from 'typeorm';
import { Invoice, InvoiceStatus } from './invoice.entity';
export declare class InvoicesService {
    private repo;
    constructor(repo: Repository<Invoice>);
    findAll(): Promise<Invoice[]>;
    findOne(id: string): Promise<Invoice | null>;
    create(data: Partial<Invoice>): Promise<Partial<Invoice> & Invoice>;
    update(id: string, data: Partial<Invoice>): Promise<Invoice | null>;
    remove(id: string): Promise<{
        deleted: boolean;
    }>;
    updatePaidAmount(invoiceId: string): Promise<void>;
    findBySupplier(supplierId: string): Promise<Invoice[]>;
    findByVessel(vesselId: string): Promise<Invoice[]>;
    findUnpaidBySupplier(supplierId: string): Promise<Invoice[]>;
    findUnpaidByVessel(vesselId: string): Promise<Invoice[]>;
    getSupplierStatement(supplierId: string): Promise<{
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
    getDueAlerts(daysAhead?: number): Promise<{
        days_until_due: number;
        is_overdue: boolean;
        id: string;
        invoice_number: string;
        supplier_id: string;
        vessel_id: string;
        po_id: string;
        type: import("./invoice.entity").InvoiceType;
        status: InvoiceStatus;
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
}
