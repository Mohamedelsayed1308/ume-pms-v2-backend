import { Repository } from 'typeorm';
import { PurchaseOrder } from './purchase-order.entity';
export declare class PurchaseOrdersService {
    private repo;
    constructor(repo: Repository<PurchaseOrder>);
    findAll(): Promise<PurchaseOrder[]>;
    findOne(id: string): Promise<PurchaseOrder | null>;
    create(data: Partial<PurchaseOrder>): Promise<Partial<PurchaseOrder> & PurchaseOrder>;
    update(id: string, data: Partial<PurchaseOrder>): Promise<PurchaseOrder | null>;
    remove(id: string): Promise<{
        deleted: boolean;
    }>;
}
