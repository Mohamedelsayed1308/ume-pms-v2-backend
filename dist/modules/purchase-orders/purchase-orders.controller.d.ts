import { PurchaseOrdersService } from './purchase-orders.service';
export declare class PurchaseOrdersController {
    private svc;
    constructor(svc: PurchaseOrdersService);
    findAll(): Promise<import("./purchase-order.entity").PurchaseOrder[]>;
    findOne(id: string): Promise<import("./purchase-order.entity").PurchaseOrder | null>;
    create(body: any): Promise<Partial<import("./purchase-order.entity").PurchaseOrder> & import("./purchase-order.entity").PurchaseOrder>;
    update(id: string, body: any): Promise<import("./purchase-order.entity").PurchaseOrder | null>;
    remove(id: string): Promise<{
        deleted: boolean;
    }>;
}
