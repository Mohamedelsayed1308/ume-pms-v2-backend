import { PurchaseOrder } from '../purchase-orders/purchase-order.entity';
export declare class Supplier {
    id: string;
    name: string;
    contact_person: string;
    email: string;
    phone: string;
    address: string;
    country: string;
    is_active: boolean;
    created_at: Date;
    updated_at: Date;
    purchase_orders: PurchaseOrder[];
}
