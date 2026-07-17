import { Repository } from 'typeorm';
import { Vessel } from './vessel.entity';
export declare class VesselsService {
    private repo;
    constructor(repo: Repository<Vessel>);
    findAll(): Promise<Vessel[]>;
    findOne(id: string): Promise<Vessel | null>;
    create(data: Partial<Vessel>): Promise<Partial<Vessel> & Vessel>;
    update(id: string, data: Partial<Vessel>): Promise<Vessel | null>;
    remove(id: string): Promise<{
        deleted: boolean;
    }>;
    getStats(vesselId: string): Promise<any>;
    getSuppliersByVessel(vesselId: string): Promise<any[]>;
}
