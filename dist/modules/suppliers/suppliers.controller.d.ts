import { SuppliersService } from './suppliers.service';
export declare class SuppliersController {
    private svc;
    constructor(svc: SuppliersService);
    findAll(): Promise<import("./supplier.entity").Supplier[]>;
    findOne(id: string): Promise<import("./supplier.entity").Supplier | null>;
    getStats(id: string): Promise<{
        id: string;
        name: string;
        total_pos: number;
        total_invoices: number;
        total_invoiced: number;
        total_paid: number;
        total_outstanding: number;
    } | null>;
    create(body: any): Promise<Partial<import("./supplier.entity").Supplier> & import("./supplier.entity").Supplier>;
    update(id: string, body: any): Promise<import("./supplier.entity").Supplier | null>;
    remove(id: string): Promise<{
        deleted: boolean;
    }>;
}
