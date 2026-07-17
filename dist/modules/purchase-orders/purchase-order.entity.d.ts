import { Supplier } from '../suppliers/supplier.entity';
import { Vessel } from '../vessels/vessel.entity';
import { Invoice } from '../invoices/invoice.entity';
export declare class PurchaseOrder {
    id: string;
    po_number: string;
    supplier_id: string;
    vessel_id: string;
    description: string;
    order_date: Date;
    is_active: boolean;
    created_at: Date;
    updated_at: Date;
    supplier: Supplier;
    vessel: Vessel;
    invoices: Invoice[];
}
