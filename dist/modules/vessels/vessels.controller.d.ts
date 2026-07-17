import { VesselsService } from './vessels.service';
export declare class VesselsController {
    private svc;
    constructor(svc: VesselsService);
    findAll(): Promise<import("./vessel.entity").Vessel[]>;
    findOne(id: string): Promise<import("./vessel.entity").Vessel | null>;
    getStats(id: string): Promise<any>;
    getSuppliers(id: string): Promise<any[]>;
    create(body: any): Promise<Partial<import("./vessel.entity").Vessel> & import("./vessel.entity").Vessel>;
    update(id: string, body: any): Promise<import("./vessel.entity").Vessel | null>;
    remove(id: string): Promise<{
        deleted: boolean;
    }>;
}
