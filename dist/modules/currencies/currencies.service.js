"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CurrenciesService = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const typeorm_2 = require("typeorm");
const currency_entity_1 = require("./currency.entity");
let CurrenciesService = class CurrenciesService {
    repo;
    constructor(repo) {
        this.repo = repo;
    }
    findAll() { return this.repo.find({ order: { code: 'ASC' } }); }
    findOne(id) { return this.repo.findOneBy({ id }); }
    create(data) { return this.repo.save(data); }
    async update(id, data) {
        await this.repo.update(id, data);
        return this.findOne(id);
    }
    async remove(id) { await this.repo.delete(id); return { deleted: true }; }
    async seed() {
        const defaults = [
            { code: 'USD', name: 'US Dollar', rate_to_usd: 1 },
            { code: 'EUR', name: 'Euro', rate_to_usd: 1.08 },
            { code: 'EGP', name: 'Egyptian Pound', rate_to_usd: 0.02 },
            { code: 'AED', name: 'UAE Dirham', rate_to_usd: 0.27 },
        ];
        for (const c of defaults) {
            const exists = await this.repo.findOneBy({ code: c.code });
            if (!exists)
                await this.repo.save(c);
        }
        return { seeded: true };
    }
};
exports.CurrenciesService = CurrenciesService;
exports.CurrenciesService = CurrenciesService = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, typeorm_1.InjectRepository)(currency_entity_1.Currency)),
    __metadata("design:paramtypes", [typeorm_2.Repository])
], CurrenciesService);
//# sourceMappingURL=currencies.service.js.map