import { PurchaseOrder } from '../purchase-orders/purchase-order.entity';
export declare class Vessel {
    id: string;
    name: string;
    imo_number: string;
    flag: string;
    vessel_type: string;
    is_active: boolean;
    created_at: Date;
    updated_at: Date;
    purchase_orders: PurchaseOrder[];
}
