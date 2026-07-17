import { CurrenciesService } from './currencies.service';
export declare class CurrenciesController {
    private svc;
    constructor(svc: CurrenciesService);
    findAll(): Promise<import("./currency.entity").Currency[]>;
    seed(): Promise<{
        seeded: boolean;
    }>;
    findOne(id: string): Promise<import("./currency.entity").Currency | null>;
    create(body: any): Promise<Partial<import("./currency.entity").Currency> & import("./currency.entity").Currency>;
    update(id: string, body: any): Promise<import("./currency.entity").Currency | null>;
    remove(id: string): Promise<{
        deleted: boolean;
    }>;
}
