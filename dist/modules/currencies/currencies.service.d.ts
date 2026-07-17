import { Repository } from 'typeorm';
import { Currency } from './currency.entity';
export declare class CurrenciesService {
    private repo;
    constructor(repo: Repository<Currency>);
    findAll(): Promise<Currency[]>;
    findOne(id: string): Promise<Currency | null>;
    create(data: Partial<Currency>): Promise<Partial<Currency> & Currency>;
    update(id: string, data: Partial<Currency>): Promise<Currency | null>;
    remove(id: string): Promise<{
        deleted: boolean;
    }>;
    seed(): Promise<{
        seeded: boolean;
    }>;
}
