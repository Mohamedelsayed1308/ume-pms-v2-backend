import { Repository } from 'typeorm';
import { Supplier } from './supplier.entity';
export declare class SuppliersService {
    private repo;
    constructor(repo: Repository<Supplier>);
    findAll(): Promise<Supplier[]>;
    findOne(id: string): Promise<Supplier | null>;
    create(data: Partial<Supplier>): Promise<Partial<Supplier> & Supplier>;
    update(id: string, data: Partial<Supplier>): Promise<Supplier | null>;
    remove(id: string): Promise<{
        deleted: boolean;
    }>;
    getStats(supplierId: string): Promise<{
        id: string;
        name: string;
        total_pos: number;
        total_invoices: number;
        total_invoiced: number;
        total_paid: number;
        total_outstanding: number;
    } | null>;
}
