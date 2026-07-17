import { Supplier } from '../suppliers/supplier.entity';
import { Vessel } from '../vessels/vessel.entity';
import { PurchaseOrder } from '../purchase-orders/purchase-order.entity';
import { Payment } from '../payments/payment.entity';
export declare enum InvoiceType {
    PRELIMINARY = "preliminary",
    FINAL = "final"
}
export declare enum InvoiceStatus {
    UNPAID = "unpaid",
    PARTIAL = "partial",
    PAID = "paid",
    CANCELLED = "cancelled"
}
export declare class Invoice {
    id: string;
    invoice_number: string;
    supplier_id: string;
    vessel_id: string;
    po_id: string;
    type: InvoiceType;
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
    supplier: Supplier;
    vessel: Vessel;
    purchase_order: PurchaseOrder;
    payments: Payment[];
    get remaining_amount(): number;
}
