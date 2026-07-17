import { Invoice } from '../invoices/invoice.entity';
export declare enum PaymentType {
    ADVANCE = "advance",
    INSTALLMENT = "installment",
    FULL = "full"
}
export declare enum PaymentMethod {
    BANK_TRANSFER = "bank_transfer",
    CHEQUE = "cheque",
    CASH = "cash"
}
export declare class Payment {
    id: string;
    invoice_id: string;
    payment_type: PaymentType;
    payment_method: PaymentMethod;
    currency: string;
    amount: number;
    payment_date: Date;
    reference: string;
    notes: string;
    created_at: Date;
    invoice: Invoice;
}
